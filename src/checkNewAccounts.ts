import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { processAllUsers } from './ ProcessAllHandler';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Парсит файл new_accounts.json и извлекает login (может быть email или логин) и password
 * Формат: JSON объект, где ключи - login (email или логин), значения - пароли
 */
function parseAccountsFile(filePath: string): { login: string; password: string }[] {
  const content = readFileSync(filePath, 'utf-8');
  const accounts: { login: string; password: string }[] = [];
  
  try {
    // Парсим JSON файл
    // Убираем последнюю запятую если есть (для валидного JSON)
    const cleanedContent = content.replace(/,\s*}$/, '}');
    const data = JSON.parse(cleanedContent);
    
    // Проходим по всем парам ключ-значение
    for (const [key, value] of Object.entries(data)) {
      const login = (key as string).trim();
      const password = (value as string).trim();
      
      if (!password) {
        console.warn(`⚠️  Пропущена запись без пароля: "${login}"`);
        continue;
      }
      
      // Используем ключ как login (может быть email или логин)
      // API принимает и email, и логин
      accounts.push({ login, password });
    }
  } catch (error) {
    console.error('❌ Ошибка парсинга JSON файла:', error);
    throw error;
  }
  
  return accounts;
}

/**
 * Проверяет возможность сбора токенов для новых учетных записей
 */
async function checkNewAccounts() {
  // Путь к файлу относительно текущего файла
  const filePath = join(__dirname, 'new_accounts.json');
  
  console.log('📖 Парсинг файла с новыми учетками...');
  const accounts = parseAccountsFile(filePath);
  
  console.log(`✅ Найдено ${accounts.length} учетных записей:\n`);
  accounts.forEach((acc, idx) => {
    const isEmail = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}$/.test(acc.login);
    const type = isEmail ? 'email' : 'логин';
    console.log(`${idx + 1}. ${acc.login} (${type}) / пароль: "${acc.password}"`);
  });
  
  console.log('\n🔐 Начинаю проверку сбора токенов...\n');
  
  const results = await processAllUsers(accounts);
  
  console.log('\n📊 Результаты проверки:\n');
  console.log('='.repeat(80));
  
  let successCount = 0;
  let errorCount = 0;
  
  results.forEach((result, index) => {
    if (result.error) {
      errorCount++;
      console.log(`❌ ${index + 1}. ${result.login}`);
      console.log(`   Ошибка: ${result.error}\n`);
    } else {
      successCount++;
      console.log(`✅ ${index + 1}. ${result.login}`);
      console.log(`   UUID: ${result.uuid}`);
      console.log(`   Init tokens: ${result.initTokens?.length || 0} шт.`);
      console.log(`   Access token: ${result.access_token?.substring(0, 20)}...`);
      console.log('');
    }
  });
  
  console.log('='.repeat(80));
  console.log(`\n📈 Итого:`);
  console.log(`   ✅ Успешно: ${successCount}`);
  console.log(`   ❌ Ошибок: ${errorCount}`);
  console.log(`   📝 Всего: ${results.length}\n`);
}

// Запуск проверки
checkNewAccounts().catch((error) => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});
