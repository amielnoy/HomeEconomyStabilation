# TODO לפני הפעלת ענן מלאה

הקוד והתשתית מוכנים, אך המשימות הבאות תלויות בהגדרות חשבון ובסודות שאינם נשמרים במאגר.

## פריסה אוטומטית ב־Vercel

- [ ] להוסיף ל־GitHub Actions את `VERCEL_TOKEN`,‏ `VERCEL_ORG_ID` ו־`VERCEL_PROJECT_ID` כ־repository/environment secrets.
- [ ] להגן על ענף `main` ולדרוש מעבר של job בשם `Build and test` לפני merge.
- [ ] להפעיל ידנית את workflow ‏`CI` פעם אחת ולוודא ש־`Deploy latest version to Vercel` מפרסם את ה־commit שנבדק.
- [ ] לוודא שה־production alias הוא `home-economy-stabilation.vercel.app` ושכשל בבדיקות מונע פריסה.

## פרויקט Supabase

- [ ] ליצור פרויקט Supabase ייעודי ולבחור אזור מתאים למשתמשים ולדרישות שמירת המידע.
- [ ] להפעיל ספק Auth נבחר ולהגדיר redirect URLs רק לדומיינים המורשים.
- [ ] להריץ את `supabase/migrations/202608230001_create_app_snapshots.sql` ולוודא ש־RLS פעיל בכל שלוש הטבלאות.
- [ ] להוסיף ב־Vercel את `SUPABASE_URL` ואת `SUPABASE_PUBLISHABLE_KEY` בלבד; אין להוסיף secret או `service_role`.
- [ ] ליצור סביבת integration נפרדת, להריץ בדיקות עם משתמש בדיקה ולוודא בידוד בין שני משתמשים.
- [ ] להשלים התחברות, תיעוד הסכמה בצד השרת, מחיקה, שחזור, מדיניות שמירה, פרטי בעל השליטה ובדיקת אבטחה/ייעוץ משפטי לפני הפעלת upload בממשק.

סיום המשימות אינו משנה את עקרון ה־local-first: סירוב לסנכרון או ביטול הסכמה חייבים להשאיר את השימוש המקומי פעיל.
