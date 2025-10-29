// --- 1. ?????????????????? ---
// --- 1. ?????????????????? ---
const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const session = require('express-session');
const passport = require('passport');
const FacebookStrategy = require('passport-facebook').Strategy;
require('dotenv').config();

// --- 2. ?????????????????? ---
const app = express();
const port = process.env.PORT || 3000;

// --- 3. ??????? Google Sheets ---
const SHEET_ID = '1UkD6xPmXns7i9tkIEJwrMCO2Dm-k-nwsxXtBL4NUtZQ';
const doc = new GoogleSpreadsheet(SHEET_ID);
// let statsWorksheet; // (??????????)
let playerWorksheet; // ?????????????????????? (?????)

async function setupGoogleSheets() {
    try {
        if (!process.env.GOOGLE_CREDENTIALS) { throw new Error('GOOGLE_CREDENTIALS environment variable not set.'); }
        const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        await doc.useServiceAccountAuth({ client_email: creds.client_email, private_key: creds.private_key });
        await doc.loadInfo();
        // statsWorksheet = doc.sheetsByTitle['SpotTheDifference']; // (??????????)
        playerWorksheet = doc.sheetsByTitle['PlayerData']; // ???????????????
        // if (!statsWorksheet) console.warn("!!! Warning: Stats worksheet not found."); // (??????????)
        if (!playerWorksheet) throw new Error("!!! Critical Error: Player data worksheet ('PlayerData') not found.");
        console.log('Google Sheets: Authenticated and Loaded PlayerData.');
        await checkPlayerSheetHeaders();
    } catch (e) { console.error('Error loading Google Sheets:', e); process.exit(1); }
}

async function checkPlayerSheetHeaders() {
    try {
        await playerWorksheet.loadHeaderRow();
        const expectedHeaders = ['FacebookID', 'PlayerName', 'PaulBalance'];
        if (!playerWorksheet.headerValues || !expectedHeaders.every((value, index) => value === playerWorksheet.headerValues[index])) {
            console.warn("!!! Warning: PlayerData sheet headers incorrect/missing. Setting headers.");
            await playerWorksheet.setHeaderRow(expectedHeaders);
            console.log("PlayerData sheet headers set.");
        } else { console.log("PlayerData sheet headers verified."); }
    } catch (e) {
        try {
             console.log("Attempting set headers on PlayerData sheet.");
             await playerWorksheet.setHeaderRow(['FacebookID', 'PlayerName', 'PaulBalance']);
             console.log("PlayerData sheet headers set.");
        } catch (setHeaderError) { console.error("!!! Error setting PlayerData headers:", setHeaderError); }
    }
}

// --- 4. ??????? Express App ---
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = ['http://localhost:5001', 'http://127.0.0.1:5001', 'https://paulai.site'];
    if (!origin || allowedOrigins.indexOf(origin) !== -1) { callback(null, true); }
    else { callback(new Error('Not allowed by CORS')); }
  }, credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 5. ??????? Session ??? Passport ---
if (!process.env.SESSION_SECRET) { console.error('!!! SESSION_SECRET missing.'); process.exit(1); }
if (process.env.NODE_ENV === 'production') { app.set('trust proxy', 1); }
app.use(session({
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7, sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' }
}));
app.use(passport.initialize());
app.use(passport.session());

if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) { console.error('!!! FB App ID/Secret missing.'); process.exit(1); }
passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID, clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: process.env.FACEBOOK_CALLBACK_URL || "https://my-game-production-d713.up.railway.app/auth/facebook/callback",
    profileFields: ['id', 'displayName']
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
        console.log("FB profile:", profile.id, profile.displayName);
        if (!playerWorksheet) return done(new Error("Player sheet not init"), null);
        await playerWorksheet.loadHeaderRow(); const rows = await playerWorksheet.getRows();
        let userRow = rows.find(row => row.get('FacebookID') === profile.id); let user; const initialBalance = 500;
        if (userRow) {
            let currentBalance = parseInt(userRow.get('PaulBalance') || '0'); let nameChanged = false;
            if (userRow.get('PlayerName') !== profile.displayName) { userRow.set('PlayerName', profile.displayName); nameChanged = true; }
            if (isNaN(currentBalance)) { currentBalance = 0; userRow.set('PaulBalance', '0'); nameChanged = true; }
            if(nameChanged) await userRow.save();
            user = { id: userRow.get('FacebookID'), name: userRow.get('PlayerName'), paulBalance: currentBalance };
        } else {
            const newRowData = { FacebookID: profile.id, PlayerName: profile.displayName, PaulBalance: initialBalance.toString() };
            await playerWorksheet.addRow(newRowData);
            user = { id: profile.id, name: profile.displayName, paulBalance: initialBalance };
        } return done(null, user);
    } catch (err) { console.error("Error FB profile processing:", err); return done(err, null); }
  }
));

passport.serializeUser((user, done) => { done(null, user); });
passport.deserializeUser((user, done) => { done(null, user); });

// --- 6. API Endpoints ---

// (API /stats ??? /increment ??????????????)
/*
app.get('/stats', async (req, res) => {
    // ... ???????? ...
});
app.post('/increment', async (req, res) => {
    // ... ???????? ...
});
*/

// --- API ?????? Login/User ---
app.get('/auth/facebook', (req, res, next) => {
    console.log(`[${new Date().toISOString()}] Received request for /auth/facebook`);
    try {
        passport.authenticate('facebook', (err) => {
            if (err) {
                console.error(`[${new Date().toISOString()}] Error during passport.authenticate initiation:`, err);
                 return res.status(500).send('Error initiating Facebook Login. Check server logs.');
            }
            console.log(`[${new Date().toISOString()}] Passport authenticate called, redirect to Facebook should happen now.`);
        })(req, res, next);
    } catch (error) {
         console.error(`[${new Date().toISOString()}] Critical error calling passport.authenticate middleware:`, error);
         res.status(500).send('Critical server error during authentication setup. Check server logs.');
    }
});

app.get('/auth/facebook/callback',
    passport.authenticate('facebook', { failureRedirect: '/login-failed' }),
    (req, res) => { console.log("Login successful, user:", req.user); res.redirect('https://paulai.site/'); }
);
app.get('/login-failed', (req, res) => { res.status(401).send('Facebook Login Failed. <a href="/">Home</a>'); });
app.get('/api/user', (req, res) => {
    if(req.isAuthenticated()){res.json({loggedIn:true,user:{id:req.user.id,name:req.user.name,paulBalance:req.user.paulBalance}});}else{res.json({loggedIn:false});}
});
app.post('/logout', (req, res, next) => {
    req.logout(function(err){if(err){return next(err);}req.session.destroy((err)=>{if(err){console.error("Session destroy err:",err);return res.status(500).json({error:'Logout failed'});}res.clearCookie('connect.sid');console.log("Logout OK");res.status(
});

// --- API ???????????? Paul Coin ---
function ensureAuthenticated(req, res, next) {
    if(req.isAuthenticated()){return next();}console.warn("Unauthorized API attempt.");res.status(401).json({error:'Not authenticated'});
}
async function updateUserBalance(userId, amountChange) {
    if(!playerWorksheet){throw new Error("Player sheet unavailable");}await playerWorksheet.loadHeaderRow();const rows=await playerWorksheet.getRows();const userRow=rows.find(r=>r.get('FacebookID')===userId);if(!userRow){throw new Error(`User ${userId} n
}
app.post('/api/spendPaul', ensureAuthenticated, async (req, res) => {
    const amount=parseInt(req.body.amount||'0');const userId=req.user.id;if(amount<=0)return res.status(400).json({error:'Invalid amount'});try{const nb=await updateUserBalance(userId,-amount);req.user.paulBalance=nb;
    res.json({ success: true, newBalance: nb });
    }catch(error){console.error(`Spend err ${userId}:`,error.message);if(error.message==="Insufficient balance"){res.status(400).json({error:'Insufficient balance'});}else{res.status(500).json({error:'Update balance failed'});}}
});
app.post('/api/earnPaul', ensureAuthenticated, async (req, res) => {
    const amount=parseInt(req.body.amount||'0');const reason=req.body.reason||'unknown';const userId=req.user.id;if(amount<=0)return res.status(400).json({error:'Invalid amount'});try{const nb=await updateUserBalance(userId,amount);req.user.paulBalance=n
    res.json({ success: true, newBalance: nb });
    }catch(error){console.error(`Earn err ${userId}:`,error.message);res.status(500).json({error:'Update balance failed'});}
});

// --- 7. ????????????? ---
setupGoogleSheets().then(() => {
    app.listen(port, () => { console.log(`Server listening on port ${port}`); });
}).catch(err => { console.error("Failed setup. Server exit.", err); process.exit(1); });
