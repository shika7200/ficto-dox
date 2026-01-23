import { ApiService } from "./ApiService";

/**
 * Обрабатывает массив объектов с login (может быть email или логин) и password.
 *
 * Для каждого элемента выполняется:
 * - Авторизация (login) с использованием ApiService.
 * - Получение uuid через getUuid.
 * - Получение 19 init_token через getInitTokens.
 *
 * Если для какого-либо пользователя возникает ошибка, в результат добавляется объект с полем error.
 *
 * @param users - Массив объектов, содержащих login (email или логин) и password.
 *                Для обратной совместимости также принимает поле email вместо login.
 * @returns Массив объектов с результатом для каждого пользователя.
 */
export async function processAllUsers(users: ({ login: string; password: string } | { email: string; password: string })[]): Promise<any[]> {
  const apiService = new ApiService();

  const userPromises = users.map(async (user) => {
    // Поддерживаем оба варианта: login и email (для обратной совместимости)
    const login = 'login' in user ? user.login : user.email;
    
    if (!login || !user.password) {
      return { login: login || null, error: "Отсутствует login или пароль" };  
    }

    try {
      // Передаем login в метод login (API принимает и email, и логин в поле email)
      const tokens = await apiService.login(login, user.password);
      
      // Получение UUID с дополнительным контекстом ошибки
      const uuid = await apiService.getUuid(tokens.access_token);
      
      // Получение init_tokens с дополнительным контекстом ошибки
      const initTokens = await apiService.getInitTokens(uuid, tokens.access_token);
      
      return {
        login,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        uuid,
        initTokens
      };
    } catch (error: any) {
      return { login, error: error.message || "Неизвестная ошибка" };
    }
  });

  // Дожидаемся завершения всех запросов
  return await Promise.all(userPromises);
}
