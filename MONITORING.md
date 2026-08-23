# ניטור מקומי באמצעות Grafana

## מה מנוטר

שירות ה־API חושף את `/metrics` רק בתוך רשת Docker. בכל scrape הוא בודק את דף האפליקציה ואת Swagger UI ומפרסם מדדי Prometheus:

- `home_economy_endpoint_up` — זמינות `application`,‏ `swagger` ו־`api`.
- `home_economy_endpoint_duration_seconds` — זמן הבדיקה האחרון של נקודות הקצה.
- `home_economy_process_uptime_seconds` — זמן הפעילות של תהליך ה־API.
- `home_economy_http_requests_total` — מספר תגובות לפי method וקוד HTTP.

Prometheus אוסף כל 10 שניות ושומר עד שבעה ימים ב־volume מקומי. Grafana מקבל אוטומטית datasource ו־dashboard בשם **Home Economy Health**.

## הפעלה וכיבוי

```bash
npm run stack:start
npm run stack:stop
```

הסקריפטים משתמשים בשם Compose קבוע ונפרד (`home-economy-local`), ולכן סביבת הפיתוח אינה מתנגשת בסביבת הבדיקות ואפשר לכבות אותה בבטחה בלי לגעת ב־containers אחרים.

לאחר ההפעלה:

- יישום: `http://127.0.0.1:8765`
- Swagger: `http://127.0.0.1:8765/api-docs.html`
- API health: `http://127.0.0.1:3001/health`
- Prometheus: `http://127.0.0.1:9090`
- Grafana: `http://127.0.0.1:3000`

ברירת המחדל המקומית של Grafana היא `admin` / `admin`. יש להגדיר `GRAFANA_ADMIN_USER` ו־`GRAFANA_ADMIN_PASSWORD` לפני שימוש במחשב משותף או בכל סביבה שאינה פיתוח. הפורטים נקשרים ל־`127.0.0.1` בלבד.

אפשר לשנות פורטים ופרטי כניסה בלי לערוך קבצים:

```bash
APP_PORT=8080 PROMETHEUS_PORT=9191 GRAFANA_PORT=3100 \
GRAFANA_ADMIN_USER=local-admin GRAFANA_ADMIN_PASSWORD='choose-a-local-password' \
npm run stack:start
```

`npm run test:docker` משתמש ב־Compose project נפרד בשם `home-economy-tests`, מריץ את Vitest ואת Playwright במקביל, ממתין לתוצאה של שניהם ורק אז יוצר את דוח Allure ב־`http://127.0.0.1:15050`. הוא משאיר את השרתים פעילים לאחר הבדיקות. סביבת הבדיקות מקבלת פורטים נפרדים כדי שתוכל לפעול לצד סביבת הפיתוח; מכבים אותה באמצעות `npm run test:docker:stop`.

## גבול פרטיות

המדדים כוללים זמינות, זמן תגובה, method וקוד סטטוס בלבד. אין בהם JWT, כתובת דוא״ל, payload פיננסי, תוכן snapshot, תנועות או פרטי דוח. `/metrics` אינו עובר דרך Nginx ואינו נחשף ל־host בקובץ Compose הרגיל.

הניטור המקומי אינו מנטר אוטומטית את Vercel production. לפני הפעלה תפעולית יש לבחור שירות ניטור חיצוני, להגדיר התראות, הרשאות, TLS, שמירה וגיבוי, ולהימנע מחשיפת Prometheus או Grafana לאינטרנט ללא שכבת אימות.

Vercel חושף בדיקת זמינות ציבורית ומינימלית ב־`https://home-economy-stabilation.vercel.app/api/health`. היא מחזירה סטטוס שירות בלבד, ללא Supabase, נתונים פיננסיים או פרטי משתמש. היא אינה תחליף ל־Prometheus או Grafana המקומיים ואינה מעידה ש־Supabase הוגדר בהצלחה.

בדיקות החוזה של provisioning, מדדי הבריאות ופרסום Allure, יחד עם בדיקות השחרור הידניות, מתועדות ב־[TEST_PLAN.md](TEST_PLAN.md).
