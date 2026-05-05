# Train Navigator RO — Setup în 5 minute

## Ce conține acest folder

```
train-api/
├── api/
│   └── train.js        ← Backend Vercel (proxy infofer.ro)
├── public/
│   └── gps.html        ← Aplicația ta (merge pe GitHub Pages)
├── vercel.json
├── package.json
└── README.md
```

---

## Pas 1 — Deployează API-ul pe Vercel (GRATUIT)

1. Mergi pe **vercel.com** → Sign Up cu contul GitHub
2. Click **"Add New Project"**
3. Click **"Import Third-Party Git Repository"** sau upload folder
   - Alternativ: creează un repo nou pe GitHub cu fișierele din `train-api/`
   - Și importă-l în Vercel
4. Vercel detectează automat că e Node.js → click **Deploy**
5. Așteaptă ~30 secunde → primești un URL de tipul:
   ```
   https://train-api-vlad.vercel.app
   ```

**Testează API-ul:**
```
https://train-api-vlad.vercel.app/api/train?tren=10238
```
Trebuie să returneze JSON cu stațiile trenului.

---

## Pas 2 — Configurează gps.html

Deschide `public/gps.html` și modifică linia:
```javascript
var API_BASE = 'https://NUMELE-TAU.vercel.app/api/train';
```
Înlocuiește `NUMELE-TAU` cu URL-ul real primit de la Vercel. Exemplu:
```javascript
var API_BASE = 'https://train-api-vlad.vercel.app/api/train';
```

---

## Pas 3 — Încarcă pe GitHub Pages

Înlocuiește `gps.html` din repo-ul tău `vladynitu1/Vlad` cu fișierul modificat.

---

## Funcționalități

- ✅ Toate companiile: CFR, TFC, Astra, IRC, Regio, Softrans, Ferotrafic
- ✅ GPS live cu permisiune cerută automat la GO
- ✅ Hartă dark + layer OpenRailwayMap (buton 🛤 CFR)
- ✅ Listă stații cu striate automat la trecere
- ✅ Km rămași live până la stația următoare
- ✅ Ore din livret (SOS/PL) indiferent de întârziere
- ✅ Funcționează pe iOS Safari, Android Chrome
