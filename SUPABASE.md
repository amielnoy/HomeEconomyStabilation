# תשתית Supabase

## סטטוס

שלוש המיגרציות הוחלו בפרויקט Supabase המקושר והיסטוריית ה־CLI המקומית והמרוחקת תואמת. סנכרון הענן עדיין אינו פעיל בממשק: האפליקציה ממשיכה לקרוא ולנתח דוחות מקומית בלבד. אישור ההצהרה בהגדרות נשמר במכשיר ואינו מעלה נתונים; חיבור אמיתי יחייב Supabase Auth, JWT תקף והסכמה פעילה בשרת.

הקמת הפרויקט והפעלתו מנוהלות כמשימות מפורשות ב־[`TODO.md`](TODO.md). אין לסמן את הענן כפעיל לפני שכל שערי האבטחה, הפרטיות וה־integration ברשימה הושלמו.

## מודל נתונים

| טבלה | מטרה | נשמר | לא נשמר |
|---|---|---|---|
| `user_profiles` | העדפות חשבון מינימליות | מזהה משתמש ושפה | שם, כתובת או נתונים פיננסיים |
| `app_snapshots` | גיבוי ושחזור של מצב האפליקציה | snapshot מצומצם וגרסתי אחד לכל משתמש | JWT, מספרי חשבון/כרטיס, CVV, אסמכתאות, שמות קבצים, ממצאי סוכנים או לוג פעילות |
| `consent_acceptances` | הוכחת בחירה גרסתית | מטרה, גרסת הצהרה, שפה, זמן קבלה/ביטול | חתימה גרפית, שם מוקלד או כתובת IP |

ה־snapshot בגרסה 2 מוגבל ל־1MB. מערכי תנועות, כללים וקטגוריות מוגבלים גם בקוד לפני יצירת בקשת רשת; מערך חשבונות או תנועה שלא עברה צמצום נדחים. כל הטבלאות קשורות ל־`auth.users` עם `on delete cascade`.

## מחלקות וגבולות

- `SupabaseSnapshotRepository` בצד הדפדפן מממש את `CloudSnapshotClient`. הוא מקבל callback ל־access token ואינו שומר אותו.
- `SupabaseRestClient` ב־Python מאמת משתמש דרך `/auth/v1/user` וניגש ל־PostgREST עם ה־JWT שלו.
- `UserProfileRepository`,‏ `SnapshotRepository` ו־`ConsentRepository` מרכזים קריאה, יצירה, עדכון ומחיקה עם סינון owner מפורש בנוסף ל־RLS.
- `LocalConsentRepository` קורא, מתעד ומבטל הסכמה מקומית לפי `CLOUD_CONSENT_VERSION`.
- `CloudSyncError` מחזיר קוד ומצב יציבים בלי לחשוף הודעות פנימיות של Supabase.
- `/api/snapshots` מאמת method, קצב, media type, גודל ומבנה לפני אימות המשתמש ופעולת ספק יקרה. לאחר מכן הוא מאמת configuration,‏ Bearer token ומשתמש לפני קריאה או כתיבה.
- `AppStateCodec` ו־DTO מבוסס allowlist דוחים שדות לא מוכרים; `SupabaseSnapshotRepository` מפעיל timeout מפורש ואינו מבצע retry אוטומטי לכתיבה.
- `runFinancialAgents` נשאר pure; תוצאות סוכנים אינן חלק ממודל ההתמדה.

## אבטחה

- משתמשים ב־`SUPABASE_PUBLISHABLE_KEY` בפורמט `sb_publishable_...`; אין שימוש ב־secret או `service_role`.
- ה־API מאמת JWT באמצעות `/auth/v1/user` לפני גישה למסד.
- RLS ו־grants פועלים יחד: `anon` חסום, ו־`authenticated` רשאי לפעול רק כאשר `auth.uid() = user_id`.
- ה־API מוגש מאותו origin, אינו משתמש ב־cookies ומחזיר `Cache-Control: no-store`.
- payload לא תקין או גדול מדי נדחה לפני כתיבה. שגיאת ספק מוחזרת כקוד כללי.
- קיימת הגבלת קצב מקומית, חסומה בזיכרון, עם `Retry-After`. בפריסה אמיתית יש להפעיל בנוסף rate limiting מבוזר ב־Vercel Firewall; ההגבלה בתוך function אינה הגנת DDoS מלאה בין instances.
- אין רישום token, תוכן דוח, דוא״ל או כתובת IP בלוגי האפליקציה.
- מדדי Prometheus כוללים health, latency, method וקוד תגובה בלבד; הם אינם כוללים JWT או payload פיננסי ואינם נחשפים דרך Nginx.

## הסכמה ופרטיות

ההצהרה אינה checkbox מסומן מראש. המשתמש יכול לסרב ולהמשיך מקומית, או לבטל את ההסכמה. הטקסט מפרט את מטרת העיבוד, סוגי הנתונים, תוצאת אי־ההסכמה, מגבלות התחזיות והמשך הזכויות לפי דין. לפני הפעלה מסחרית יש להשלים פרטי בעל שליטה, ערוצי עיון/תיקון/מחיקה, תקופות שמירה, הסכם עיבוד עם ספקים ובדיקה משפטית בישראל ובמדינות היעד. גבול ההתמדה והיקף GDPR/HIPAA מפורטים ב־[PRIVACY.md](PRIVACY.md).

## הקמה

```bash
cp .env.example .env.local
npm install
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
npm run build
```

בסביבה חדשה מריצים לפי שם ובסדר את כל קובצי ה־migration בפרויקט Supabase, ומגדירים את שני המשתנים גם ב־Vercel. המיגרציה השנייה קובעת default ו־constraint לגרסה 2 כ־`NOT VALID`; השלישית מתקינה trigger לפרופיל ומאמתת את ה־constraint רק כשאין רשומות legacy. בפרויקט הפיתוח המקושר שלושתן כבר הוחלו. אפשר לבדוק את ה־API רק עם JWT אמיתי של משתמש מאומת.

לבדיקה ידנית פותחים את Swagger ב־`/api-docs.html` או את Scalar ב־`/scalar-docs.html`. ב־Scalar בוחרים פעולה ולוחצים **Test Request**; לפעולות snapshot משתמשים במנגנון Authentication כדי להזין Bearer JWT של משתמש בדיקה. שני הממשקים נטענים מנכסים מקומיים ומכסים את `GET /api/health` ואת `GET`,‏ `PUT` ו־`DELETE /api/snapshots`; Scalar מוגדר בלי telemetry ובלי שמירת authentication. החוזה המשותף, הניתן גם לייבוא לכלי API אחרים, נמצא ב־`openapi.json`.

## הפעלה עתידית

לפני הפעלת הכפתור במוצר יש להשלים, לפי הסדר:

1. Supabase Auth וניהול session מאובטח.
2. תיעוד ההסכמה גם ב־`consent_acceptances` ולא רק מקומית.
3. בדיקת הסכמה פעילה לפני כל `PUT` ראשון.
4. פעולות מפורשות: „סנכרון עכשיו”, „שחזור” ו„מחיקה מהענן”.
5. reconciliation שלא דורס מצב מקומי חדש יותר ללא אישור.
6. בדיקות integration מול פרויקט Supabase ייעודי שאינו production.

כל בדיקות ה־API, האבטחה, ההסכמה וה־RLS הנדרשות לפני ההפעלה ממופות ב־[TEST_PLAN.md](TEST_PLAN.md). אין להשתמש ב־JWT של production או בנתונים פיננסיים אמיתיים בבדיקות ידניות או אוטומטיות.
