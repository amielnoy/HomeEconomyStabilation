# TODO לפני הפעלת ענן מלאה

הקוד והתשתית מוכנים, אך המשימות הבאות תלויות בהגדרות חשבון ובסודות שאינם נשמרים במאגר.

## פריסה אוטומטית ב־Vercel

- [ ] להוסיף ל־GitHub Actions את `VERCEL_TOKEN`,‏ `VERCEL_ORG_ID` ו־`VERCEL_PROJECT_ID` כ־repository/environment secrets.
- [ ] להגן על ענף `main` ולדרוש מעבר של job בשם `Build and test` לפני merge.
- [ ] להפעיל ידנית את workflow ‏`CI` פעם אחת ולוודא ש־`Deploy latest version to Vercel` מפרסם את ה־commit שנבדק.
- [ ] לוודא שה־production alias הוא `home-economy-stabilation.vercel.app` ושכשל בבדיקות מונע פריסה.
- [ ] לשמור את `allure-report` כ־CI artifact עם מדיניות retention מתאימה, בלי לפרסם attachments שעלולים להכיל מידע רגיש.

## פרויקט Supabase

- [x] ליצור ולקשר פרויקט Supabase ייעודי.
- [ ] לאמת שהאזור, הגיבויים ותקופות השמירה מתאימים למשתמשים ולדרישות הדין.
- [ ] ליצור OAuth 2.0 Client ID ב־Google Cloud עם `https://<project>.supabase.co/auth/v1/callback` כ־redirect URI.
- [ ] להפעיל את ספק Google ב־Supabase ולהדביק Client ID ו־Client Secret.
- [ ] להגדיר ב־Supabase את `https://home-economy-stabilation.vercel.app/api/auth/callback` כ־Redirect URL, בלי wildcard.
- [ ] להגדיר בפריסה `SUPABASE_URL`,‏ `SUPABASE_PUBLISHABLE_KEY` ו־`AUTH_ALLOWED_ORIGINS`; עד אז `/api/auth/google` מחזיר `503 cloud_not_configured`.
- [x] לבנות את ממשק הכניסה בדפדפן: מצב מחובר/מנותק. בוצע ב־`docs/superpowers/plans/2026-10-08-cookie-session-auth.md` — `he_session` ה־cookie הקיים הוא מנגנון האימות, לא `accessToken()` ב־JS (token שקריא ל־JS בוטל כעיקרון עיצוב, לא רק נדחה).
- [x] לחבר את `fe/src/cloud-sync.ts` ו־`fe/src/cloud-metadata.ts` לאותו מנגנון: הוסר ה־`accessToken()` callback, והם משתמשים כעת ב־`credentials: 'include'`, באותו דפוס שכבר נבנה ב־`fe/src/open-banking.ts`.
- [x] לחבר את `SupabaseConsentRepository` בפועל ל־UI: כרטיס ההסכמה הקיים (שהיה מקומי בלבד) כותב כעת גם לענן כשהמשתמש מחובר, דרך `WriteThroughConsentRepository` (`fe/src/consent-sync.ts`) — כשל ברכיב הענן מתועד בלוקאל ולא הופך לכישלון. `SupabaseSnapshotRepository`/`SupabaseProfileRepository` עדיין לא מחוברים ל־UI — אין עדיין כפתור „סנכרון עכשיו” או מסך פרופיל.
- [x] שער ההסכמה, כולל הממשק להענקת הסכמת `open_banking` — שני כרטיסי הסכמה (cloud_sync ו־open_banking) בנויים בתא ההגדרות, עם כתיבה מקומית מיידית וכתיבה לענן כשחתום-פנימה. מה שעדיין חסר כדי שזה יהיה שימושי בפועל: כפתור הסנכרון עצמו (הפריט שמעליו) ואימות שהנוסח של הסכמת open_banking תקין — ראו הסעיף למטה.
- [ ] להחליט ולממש מה קורה לנתונים שכבר במכשיר בכניסה ראשונה — לשאול ולצרף לאחר הסכמה.
- [x] להחיל לפי הסדר את שלוש המיגרציות ולוודא שהיסטוריית המיגרציות המקומית והמרוחקת זהה; הן יוצרות שלוש טבלאות, grants,‏ RLS,‏ triggers ו־constraint לגרסה 2.
- [ ] להריץ בדיקת integration עם שני משתמשים ולוודא בפועל בידוד RLS, כתיבה, קריאה, מחיקה וטיפול מבוקר ברשומת v1.
- [ ] להפעיל rate limiting מבוזר ב־Vercel Firewall; ההגבלה המקומית ב־function היא שכבת sanity ואינה תחליף להגנת edge/DDoS.
- [ ] להוסיף ב־Vercel את `SUPABASE_URL` ואת `SUPABASE_PUBLISHABLE_KEY` בלבד; אין להוסיף secret או `service_role`.
- [ ] ליצור פרויקט integration נפרד שאינו production ולהריץ בו את בדיקות המשתמשים וה־RLS.
- [x] להוסיף API מאומת לשפת פרופיל ולהסכמה, ולחסום כתיבת snapshot ללא הסכמה פעילה בשרת.
- [ ] להשלים התחברות בממשק, חיבור מאגרי profile/consent לענן, מסכי מחיקה ושחזור, מדיניות שמירה, פרטי בעל השליטה ובדיקת אבטחה/ייעוץ משפטי לפני הפעלת upload בממשק.

סיום המשימות אינו משנה את עקרון ה־local-first: סירוב לסנכרון או ביטול הסכמה חייבים להשאיר את השימוש המקומי פעיל.

## Open Banking (פיילוט) — נותר לפני שהוא נגיש למשתמש אמיתי

- [x] לממש את `docs/superpowers/plans/2026-10-08-cookie-session-auth.md`: הופעל — `he_session` הוא מנגנון האימות האמיתי, גם עבור cloud-sync וגם עבור Open Banking.
- [x] לבנות ממשק להענקת ההסכמה הייעודית — כרטיס הסכמה ל־`open_banking` בנוי בתא ההגדרות, כולל `GET`/`DELETE /api/consents/open-banking` חדשים בשרת (לא היו קיימים, רק `PUT`) לקריאת המצב הנוכחי וביטול. עדיין דורש בדיקה ידנית של הנוסח — ראו הערה ב־README.md.
- [ ] לצמצם את ה־revoke-on-refusal ל־400 עם `body.error == "invalid_grant"` בלבד, במקום כל 400/401 — טעות תצורה שלנו לא אמורה לבטל חיבור משתמש. חובה לפני הפעלת `OPEN_BANKING_LICENCE_ID` ב־production.
- [ ] לסדר (serialize) sync חופפים על אותו חיבור, כדי ש־rotation של refresh token לא יבטל חיבור שסונכרן בהצלחה הרגע.
- [ ] לאמת את ה־sandbox האמיתי של בנק הפועלים ולהתאים את `server/open_banking_sync.py` לצורת הקריאה האמיתית של NextGenPSD2 (שלב consent resource,‏ `Consent-ID`,‏ `X-Request-ID`,‏ `PSU-IP-Address`, תעודת client) — צריך credentials אמיתיים מ־poalimdev.co.il שלא היו זמינים עד כה.

## ניטור production

- [ ] לבחור שירות ניטור חיצוני עבור Vercel ולהגדיר health check מהאינטרנט ללא מידע רגיש.
- [ ] להגדיר התראות לזמינות, latency ושיעור שגיאות 5xx עם בעל תפקיד ונתיב escalation.
- [ ] להחליף credentials מקומיים, להפעיל TLS ואימות, ולהגדיר retention וגיבוי לפני חשיפת Grafana או Prometheus מחוץ למחשב פיתוח.

## שער בדיקות לפני production

- [ ] להריץ את כל ה־release gate המתועד ב־`TEST_PLAN.md` ולשמור קישור ל־Allure בגרסת השחרור.
- [ ] להשלים בדיקות ידניות על iPhone ו־Android פיזיים עם VoiceOver ו־TalkBack.
- [ ] לוודא שהקישורים לפעמונים, למקימי ולערוץ WhatsApp של פעמונים עדיין רשמיים ושנוסחי הזכאות או מטרת הערוץ לא השתנו.
