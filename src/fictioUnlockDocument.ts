import { ApiService } from "./ApiService";
import type { InputJson } from "./apiService_types";
import { getReportConfig } from "./reportConfig";

type DocumentStatusSnapshot = {
  disabled_complite: boolean;
  build_id: number;
  status_id: number;
  message: string | null;
};

export type FictioUnlockDocumentResult = {
  documentId: number;
  panelId: number;
  buildId: number;
  statusId: number;
  statusMessage: string | null;
  attemptedCancel: boolean;
  cancelled: boolean;
  skippedReason?: string;
};

type ReportConfigLike = {
  statusPanelId?: number;
  checkErrorsPanelId?: number;
  panelIdBySection?: Record<string, number>;
};

const DEFAULT_UNLOCK_DOCUMENT_ID = 339;
const DEFAULT_UNLOCK_PANEL_ID = 3289;
const DEFAULT_UNLOCK_WORKSPACE_INDEX = 21;

export function shouldCancelDocumentLock(
  document: Pick<DocumentStatusSnapshot, "disabled_complite">
): boolean {
  return document.disabled_complite === true;
}

export function isCancelForbiddenForCurrentStatus(message: string): boolean {
  const normalized = String(message).toLowerCase();
  return (
    normalized.includes("статус 409") &&
    normalized.includes("запрещено изменение статуса отчета")
  );
}

export function buildStatusPanelCandidates(config: ReportConfigLike): number[] {
  const candidates = [
    config.statusPanelId,
    config.checkErrorsPanelId,
    ...Object.values(config.panelIdBySection ?? {}),
  ];
  const uniq: number[] = [];
  for (const id of candidates) {
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
    if (!uniq.includes(id)) uniq.push(id);
  }
  return uniq;
}

export function resolveUnlockStatusParams(input: {
  fictoDocumentId?: number;
}): {
  documentId: number;
  panelId: number;
  workspaceIndex: number;
} {
  const hasFictoDocumentId =
    typeof input.fictoDocumentId === "number" &&
    Number.isFinite(input.fictoDocumentId);

  return {
    // По рабочему сценарию разблокировки статус берется с documents/339.
    documentId: hasFictoDocumentId
      ? Number(input.fictoDocumentId)
      : DEFAULT_UNLOCK_DOCUMENT_ID,
    panelId: DEFAULT_UNLOCK_PANEL_ID,
    workspaceIndex: DEFAULT_UNLOCK_WORKSPACE_INDEX,
  };
}

export async function FictioUnlockDocument(
  inputJson: InputJson
): Promise<FictioUnlockDocumentResult> {
  const api = new ApiService();
  const reportConfig = getReportConfig(inputJson.reportType);

  const email = inputJson.fictoLogin;
  const password = inputJson.fictoPass;

  const { access_token } = await api.login(email, password, {
    miccedoLogin: inputJson.micceduLogin,
    miccedoPass: inputJson.micceduPass,
  });
  const uuid = await api.getUuid(access_token);
  const unlockParams = resolveUnlockStatusParams({
    fictoDocumentId: inputJson.fictoDocumentId,
  });

  let statusToken: string;
  try {
    statusToken = await api.getInitTokenByWorkspaceIndex(
      uuid,
      access_token,
      unlockParams.workspaceIndex
    );
  } catch {
    // Если конкретный workspace 21 недоступен, fallback на последний доступный token.
    const initTokens = await api.getInitTokens(uuid, access_token, {
      requiredCount: 1,
      maxWorkspaceIndex: 21,
    });
    if (initTokens.length < 1) {
      throw new Error(`Ожидался минимум 1 initToken, получили ${initTokens.length}`);
    }
    statusToken = initTokens[initTokens.length - 1];
  }

  const panelCandidates = [
    unlockParams.panelId,
    ...buildStatusPanelCandidates(reportConfig).filter(
      (id) => id !== unlockParams.panelId
    ),
  ];

  let selectedPanelId: number | null = null;
  let status:
    | Awaited<ReturnType<ApiService["getDocumentStatus"]>>
    | null = null;
  let lastError: unknown = null;

  for (const panelId of panelCandidates) {
    try {
      status = await api.getDocumentStatus(
        unlockParams.documentId,
        panelId,
        statusToken
      );
      selectedPanelId = panelId;
      break;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const isForbiddenPanel =
        message.includes("Статус 409") &&
        message.includes("Запрещено использование данной панели");
      if (isForbiddenPanel) continue;
      throw err;
    }
  }

  if (!status || !selectedPanelId) {
    const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `Не удалось получить status по доступным panel_id (${panelCandidates.join(", ")}). Последняя ошибка: ${errMsg}`
    );
  }

  const snapshot: DocumentStatusSnapshot = {
    disabled_complite: status.document.disabled_complite,
    build_id: status.document.build_id,
    status_id: status.document.status_id,
    message: status.document.message,
  };

  if (!shouldCancelDocumentLock(snapshot)) {
    return {
      documentId: unlockParams.documentId,
      panelId: selectedPanelId,
      buildId: snapshot.build_id,
      statusId: snapshot.status_id,
      statusMessage: snapshot.message,
      attemptedCancel: false,
      cancelled: false,
      skippedReason: "Документ не в состоянии блокировки для отмены",
    };
  }

  let cancelResp: { status: boolean };
  try {
    cancelResp = await api.cancelDocumentLock(
      unlockParams.documentId,
      snapshot.build_id,
      selectedPanelId,
      statusToken
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isCancelForbiddenForCurrentStatus(message)) {
      throw err;
    }
    cancelResp = await api.revokeSignature(
      unlockParams.documentId,
      snapshot.build_id,
      selectedPanelId,
      statusToken
    );
  }

  return {
    documentId: unlockParams.documentId,
    panelId: selectedPanelId,
    buildId: snapshot.build_id,
    statusId: snapshot.status_id,
    statusMessage: snapshot.message,
    attemptedCancel: true,
    cancelled: cancelResp.status === true,
  };
}
