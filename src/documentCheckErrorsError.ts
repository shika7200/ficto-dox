/** Выбрасывается при ненулевом списке ошибок из API check-errors; несёт массив для UI. */
export class DocumentCheckErrorsError extends Error {
  readonly errors: unknown[]

  constructor(message: string, errors: unknown[]) {
    super(message)
    this.name = "DocumentCheckErrorsError"
    this.errors = errors
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
