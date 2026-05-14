# Zdravotní průvodce — osobní PWA

Osobní webová aplikace propojující ájurvédu, TCM a psychosomatiku. Postavená pro Zuzanu.

---

## 🚀 Rychlý start (Windows PC)

1. Otevři **File Explorer** a najdi tento adresář: `C:\Users\zuzan\Documents\AI.coding\health-app\`
2. **Dvojklik na `index.html`** — otevře se v prohlížeči (ideálně Chrome nebo Edge).
3. Při prvním spuštění aplikace ukáže okno pro **Gemini API klíč** — zadej svůj klíč (získáš ho na https://aistudio.google.com), klikni "Uložit".
4. Hotovo. Aplikace je funkční.

> 💡 Pro pohodlí: Klikni v prohlížeči pravým tlačítkem na záložku → "Přidat na pracovní plochu". Tím dostaneš zástupce, který appku otevírá jedním klikem.

---

## 📱 Spuštění na iPhonu

Bude doplněno po nasazení na GitHub Pages (potřebuju od tebe GitHub username).

---

## 🏗️ Struktura projektu

```
health-app/
├── index.html              ← spouštěč
├── app.js                  ← hlavní logika
├── style.css               ← vzhled
├── manifest.json           ← PWA metadata
├── data-bundle.js          ← bundlovaná data (automaticky vygenerované)
├── rebuild-data.ps1        ← script pro regeneraci bundle
├── data/                   ← zdrojová data v JSON
│   ├── foods.json          ← databáze potravin
│   ├── herbs.json          ← databáze bylin
│   ├── profile-seed.json   ← Zuzanin počáteční profil
│   └── timeline-seed.json  ← časová osa z Gemini konverzace
├── lib/                    ← knihovny
│   ├── storage.js          ← localStorage wrapper
│   └── gemini.js           ← Gemini API klient + prompty
└── icons/                  ← ikony PWA
```

---

## 🔒 Bezpečnost

- **API klíč** je uložen **jen v tvém prohlížeči** (localStorage). Nikdy se neposílá nikam jinam než přímo do Google Gemini.
- `.gitignore` chrání `.env` a `config.local.js` — pokud bys něco takového vytvořila, nedostane se to do GitHubu.
- Pokud klíč někam unikne, **kdykoli ho můžeš zneplatnit**: https://aistudio.google.com → API keys → Delete.

---

## 🧬 Co aplikace dělá

| Záložka | Funkce |
|---|---|
| **📓 Deník** | Denní zápis: nálada, jídlo, příznaky. Vše uložené lokálně. |
| **💭 Otázka** | Popíšeš problém → AI ho rozdělí do 3 sekcí (ájurvéda, TCM, psychosomatika) + souhrnná rada. Bere v úvahu tvůj profil a poslední záznamy z deníku. |
| **🥗 Jídlo & Byliny** | Hledání potraviny nebo byliny → vlastnosti v TCM + ájurvédě + vhodnost přímo pro tebe. Tlačítko "Zkontrolovat kombinaci" — zadej víc položek čárkou, AI zkontroluje kompatibilitu. |
| **👤 Profil** | Tvoje konstituce, historie, doplňky. Editovatelný JSON (později nahradí formulář). |

---

## 🛠️ Když chci upravit databázi

1. Otevři `data/foods.json` nebo `data/herbs.json` v textovém editoru (např. Notepad++, VS Code, nebo i Notepad)
2. Přidej / uprav záznam (dodrž JSON syntaxi!)
3. **Spusť `rebuild-data.ps1`** (pravým tlačítkem → "Spustit pomocí PowerShellu")
4. Aktualizuj prohlížeč (F5)

Pokud PowerShell hlásí "spouštění scriptů zakázáno", otevři PowerShell jako Admin a zadej:
```
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```
Pak zkus znovu.

---

## ⚠️ Důležité upozornění

Tato aplikace **není náhrada lékaře**. U vážných příznaků (silné migrény s aurou, abnormální menstruace, akutní bolesti) **konzultuj lékaře**.

Aplikace má integrované varování — pokud popíšeš příznak ze seznamu "red flags" (definovaného v profilu), AI ti vždy připomene odbornou péči.
