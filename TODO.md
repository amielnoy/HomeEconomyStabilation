# TODO לפני הפעלת ענן מלאה

הקוד והתשתית מוכנים, אך המשימות הבאות תלויות בהגדרות חשבון ובסודות שאינם נשמרים במאגר.

## פריסה אוטומטית ב־Vercel

- [ ] להוסיף ל־GitHub Actions את `VERCEL_TOKEN`,‏ `VERCEL_ORG_ID` ו־`VERCEL_PROJECT_ID` כ־repository/environment secrets.
- [ ] להגן על ענף `main` ולדרוש מעבר של job בשם `Build and test` לפני merge.
- [ ] להפעיל ידנית את workflow ‏`CI` פעם אחת ולוודא ש־`Deploy latest version to Vercel` מפרסם את ה־commit שנבדק.
- [ ] לוודא שה־production alias הוא `home-economy-stabilation.vercel.app` ושכשל בבדיקות מונע פריסה.
- [ ] לשמור את `allure-report` כ־CI artifact עם מדיניות retention מתאימה, בלי לפרסם attachments שעלולים להכיל מידע רגיש.

## פרויקט Supabase

- [ ] ליצור פרויקט Supabase ייעודי ולבחור אזור מתאים למשתמשים ולדרישות שמירת המידע.
- [ ] להפעיל ספק Auth נבחר ולהגדיר redirect URLs רק לדומיינים המורשים.
- [ ] להריץ לפי הסדר את שני הקבצים ב־`supabase/migrations/`, לוודא ש־RLS פעיל בכל שלוש הטבלאות ולבדוק מעבר מבוקר של רשומות v1 לפני אימות constraint v2.
- [ ] להפעיל rate limiting מבוזר ב־Vercel Firewall; ההגבלה המקומית ב־function היא שכבת sanity ואינה תחליף להגנת edge/DDoS.
- [ ] להוסיף ב־Vercel את `SUPABASE_URL` ואת `SUPABASE_PUBLISHABLE_KEY` בלבד; אין להוסיף secret או `service_role`.
- [ ] ליצור סביבת integration נפרדת, להריץ בדיקות עם משתמש בדיקה ולוודא בידוד בין שני משתמשים.
- [ ] להשלים התחברות, תיעוד הסכמה בצד השרת, מחיקה, שחזור, מדיניות שמירה, פרטי בעל השליטה ובדיקת אבטחה/ייעוץ משפטי לפני הפעלת upload בממשק.

סיום המשימות אינו משנה את עקרון ה־local-first: סירוב לסנכרון או ביטול הסכמה חייבים להשאיר את השימוש המקומי פעיל.

## ניטור production

- [ ] לבחור שירות ניטור חיצוני עבור Vercel ולהגדיר health check מהאינטרנט ללא מידע רגיש.
- [ ] להגדיר התראות לזמינות, latency ושיעור שגיאות 5xx עם בעל תפקיד ונתיב escalation.
- [ ] להחליף credentials מקומיים, להפעיל TLS ואימות, ולהגדיר retention וגיבוי לפני חשיפת Grafana או Prometheus מחוץ למחשב פיתוח.

## שער בדיקות לפני production

- [ ] להריץ את כל ה־release gate המתועד ב־`TEST_PLAN.md` ולשמור קישור ל־Allure בגרסת השחרור.
- [ ] להשלים בדיקות ידניות על iPhone ו־Android פיזיים עם VoiceOver ו־TalkBack.
- [ ] לוודא שהקישורים לפעמונים, למקימי ולערוץ WhatsApp של פעמונים עדיין רשמיים ושנוסחי הזכאות או מטרת הערוץ לא השתנו.
