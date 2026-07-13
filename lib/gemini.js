/**
 * Gemini API client + prompt builders
 *
 * Volá Google Gemini API přímo z prohlížeče.
 * API klíč je v localStorage uživatele — nikdy se neposílá nikam jinam.
 *
 * Exposes: window.GeminiClient, window.buildSystemPrompt,
 *          window.buildFoodLookupPrompt, window.buildHerbLookupPrompt,
 *          window.buildCombineCheckPrompt, window.buildAnalyzePrompt
 */

(function() {

  const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  class GeminiClient {
    constructor(apiKey, model = 'gemini-2.5-flash') {
      if (!apiKey) throw new Error('API klíč chybí');
      this.apiKey = apiKey;
      this.model = model;
    }

    async generate(messages, systemInstruction = null, options = {}) {
      const url = `${GEMINI_API_BASE}/${this.model}:generateContent?key=${this.apiKey}`;

      const body = {
        contents: messages.map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        })),
        generationConfig: {
          temperature: options.temperature ?? 0.6,
          topP: options.topP ?? 0.9,
          maxOutputTokens: options.maxOutputTokens ?? 4096
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
        ]
      };

      if (systemInstruction) {
        body.systemInstruction = {
          parts: [{ text: systemInstruction }]
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsed;
        try { parsed = JSON.parse(errorText); } catch {}
        const message = parsed?.error?.message ?? errorText;
        throw new Error(`Gemini API ${response.status}: ${message}`);
      }

      const data = await response.json();

      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error('Gemini nevrátil žádnou odpověď. Možná byl prompt zablokován bezpečnostními filtry.');
      }

      const text = candidate.content?.parts?.map(p => p.text).join('') ?? '';
      if (!text) {
        throw new Error('Gemini vrátil prázdnou odpověď.');
      }
      return text;
    }
  }

  function buildSystemPrompt({ profile, recentEntries, foodsDb, herbsDb }) {
    const profileSection = profile ? formatProfileForPrompt(profile) : '(profil zatím nenastaven)';
    const recentSection = recentEntries?.length
      ? formatRecentEntries(recentEntries)
      : '(žádné nedávné záznamy z deníku)';

    return `Jsi osobní zdravotní průvodce pro Zuzanu (42 let, Praha). Spojuješ čtyři přístupy:
• **Ájurvédu** — klasika (Charaka Samhita, Sushruta Samhita, Ashtanga Hridaya, Bhavaprakasha) + recentní výzkum (AYUSH ministerstvo, PubMed publikace 2020-2026)
• **TCM — tradiční čínskou medicínu** — klasika (Huangdi Neijing, Shennong Ben Cao Jing, Shang Han Lun, Pen Cao Gang Mu) + současné autority (Bensky Materia Medica, Maciocia "Foundations of Chinese Medicine")
• **Psychosomatiku** — Gabor Maté ("When the Body Says No", "The Myth of Normal" 2022), Bessel van der Kolk ("The Body Keeps the Score"), Peter Levine (Somatic Experiencing), John Sarno (TMS)
• **Neurovědu a interocepci (nová oblast — sleduj recentní výzkum!)** — Stephen Porges (polyvagální teorie, "The Polyvagal Theory" 2011, novější "Our Polyvagal World" 2023), Lisa Feldman Barrett ("How Emotions Are Made" 2017, "Seven and a Half Lessons About the Brain" 2020, konstrukční teorie emocí), Antonio Damasio (somatické markery, "The Feeling of What Happens"), A.D. (Bud) Craig (interocepce, insula), Daniel Siegel (interpersonální neurobiologie), Antonio D'Amasio, Sarah McKay (neuroscience of women's health).

**Aktivně čerpej z novějšího výzkumu 2023-2026** v následujících oblastech:
- Polyvagální teorie a autonomní nervový systém
- Interocepce a insula (jak tělo vnímá samo sebe)
- Osa střevo-mozek (gut-brain axis), mikrobiom a chronické stavy
- HPA osa (stres, kortizol, adrenální únava)
- Psychoneuroimunologie (PNI) — jak emoce ovlivňují imunitu
- Trauma-informovaná medicína
- Chronobiologie a cirkadiánní rytmy
- Ženská hormonální rovnováha (perimenopauza od 40+)
- Hypothyreóza — recentní pochopení subklinických stavů
- Migréna s aurou — novější neurobiologické modely (šířící se kortikální deprese)

Když odpovídáš, aktivně **propojuj tyto perspektivy s klasickou tradicí**. Ukazuj, jak novější věda potvrzuje (nebo občas přeformuluje) klasické pojmy.

# NEPORUŠITELNÁ PRAVIDLA

1. **Žádné výmysly.** Tvrzení musí mít oporu v klasických textech nebo recentním výzkumu. Pokud si nejsi jistá, řekni to.

2. **Označuj návrhy.** Cokoli, co je tvoje úvaha (ne přímo doložené), označ explicitně: **"Možný návrh:"** nebo **"Hypotéza:"** nebo **"Domněnka:"**. Fakta zůstávají bez označení.

3. **Bezpečnost.** U následujících příznaků vždy připoj větu: *"⚠️ Toto patří k lékaři, nelze řešit jen bylinkami."*
   - Migrény s vizuální aurou
   - Předčasná nebo nepravidelná menstruace, neobvyklé krvácení
   - Vypadávání obočí ve vnější třetině (možná hypothyreóza)
   - Mizející zubní sklovina
   - Akutní silné bolesti
   - Cokoli neobvyklého a vážného

4. **Lékové a bylinné interakce.** Když navrhuješ bylinu nebo doplněk, vždy zmiň hlavní kontraindikace a interakce. Pokud uživatelka bere jakékoli léky, doporuč konzultaci s lékárníkem.

5. **Respektuj historii.** Zuzana měla anorexii ve 20+, 22 let převážně syrové stravy, nedávný incident s olivovým listem (Herxheimerova reakce). Její tělo je citlivé na agresivní detoxikační byliny. Postup je: nejdřív výživa a otevření odtoků, pak teprve čištění.

6. **Strukturuj odpovědi.** Pokud uživatelka popíše problém, rozděl ho do sekcí:
   - **🌿 Ájurvéda:** ...
   - **🀄 TCM:** ...
   - **🧠 Psychosomatika:** ...
   - **💡 Souhrnná rada:**
   ...a vždy uveď, na co si dát pozor.

7. **Čeština.** Odpovídej česky, odborné termíny (sanskrt, čínské) ponech v originále s českým vysvětlením.

8. **Praktičnost.** Nesnaž se "uzdravit vše najednou". Navrhuj postupné kroky, podle aktuálního stavu.

# PROFIL ZUZANY

${profileSection}

# NEDÁVNÉ ZÁZNAMY Z DENÍKU

${recentSection}

# DOSTUPNÉ DATABÁZE (pro tvoji informaci)

Aplikace má lokální databáze potravin a bylin, které doplňují tvé znalosti.

Potraviny v databázi (ID): ${foodsDb?.foods?.map(f => f.id).join(', ') || 'načítá se'}
Byliny v databázi (ID): ${herbsDb?.herbs?.map(h => h.id).join(', ') || 'načítá se'}

Pamatuj: jsi průvodkyně, ne lékař. Aplikace nenahrazuje péči.`;
  }

  function formatProfileForPrompt(p) {
    const lines = [];

    if (p.basic) {
      lines.push(`**Základní:** ${p.basic.name}, ${p.basic.age} let, ${p.basic.location}, pracuje pro ${p.basic.occupation}`);
    }

    if (p.ayurveda) {
      lines.push(`\n**Ájurvédský profil:**`);
      if (p.ayurveda.prakriti) lines.push(`- Prakriti: ${p.ayurveda.prakriti}`);
      if (p.ayurveda.vikriti) lines.push(`- Vikriti (aktuální nerovnováha): ${p.ayurveda.vikriti}`);
      if (p.ayurveda.agni) lines.push(`- Agni: ${p.ayurveda.agni}`);
      if (p.ayurveda.ama) lines.push(`- Ama: ${p.ayurveda.ama}`);
    }

    if (p.tcm) {
      lines.push(`\n**TCM profil:**`);
      if (p.tcm.mainPattern) lines.push(`- Hlavní vzorec: ${p.tcm.mainPattern}`);
      if (p.tcm.secondaryPatterns?.length) {
        lines.push(`- Sekundární: ${p.tcm.secondaryPatterns.join('; ')}`);
      }
    }

    if (p.psychosomatic?.patterns?.length) {
      lines.push(`\n**Psychosomatika:**`);
      p.psychosomatic.patterns.forEach(x => lines.push(`- ${x}`));
    }

    if (p.symptoms?.current?.length) {
      lines.push(`\n**Aktuální příznaky:**`);
      p.symptoms.current.forEach(s => lines.push(`- ${s}`));
    }

    if (p.symptoms?.historical?.length) {
      lines.push(`\n**Historický kontext:**`);
      p.symptoms.historical.forEach(s => lines.push(`- ${s}`));
    }

    if (p.currentSupplements?.haveAtHome?.length) {
      lines.push(`\n**Co aktuálně bere / má doma:** ${p.currentSupplements.haveAtHome.join(', ')}`);
    }

    if (p.redFlags?.length) {
      lines.push(`\n**🚩 Red flags (vždy připomenout u relevantních dotazů):**`);
      p.redFlags.forEach(r => lines.push(`- ${r}`));
    }

    return lines.join('\n');
  }

  function formatRecentEntries(entries) {
    return entries.slice(0, 5).map(e => {
      const date = new Date(e.date).toLocaleDateString('cs-CZ');
      return `**${date}** — Nálada: ${e.nalada || '-'}\nJídlo: ${e.jidlo || '-'}\nPříznaky: ${e.priznaky || '-'}`;
    }).join('\n\n');
  }

  function buildFoodLookupPrompt(query, profile, foodFromDb) {
    let context = '';
    if (foodFromDb) {
      context = `\n\nDatabáze obsahuje záznam pro tuto potravinu:\n\`\`\`json\n${JSON.stringify(foodFromDb, null, 2)}\n\`\`\`\nMůžeš se na něj odkázat a doplnit ho.`;
    }

    return `Uživatelka se ptá na potravinu/jídlo: **"${query}"**

Pokud zná, dej jí strukturovaný profil:

**🌿 Ájurvéda:** rasa, virya, vipaka, vliv na dóši, kvalita
**🀄 TCM:** termická povaha, chuť, dráhy, akce
**🔬 Moderní:** klíčové živiny, klinický pohled, případné kontroverze
**👤 Pro tebe konkrétně:** vyhodnocení vzhledem k jejímu profilu (deficit Sleziny, Vlhká Horkost, deficit Yin/Jing) — vhodné/opatrně/vyhnout se + proč
**🍽️ Příprava:** doporučená úprava pro její konstituci

Pokud o potravině moc nevíš, otevřeně to řekni.${context}`;
  }

  function buildHerbLookupPrompt(query, profile, herbFromDb) {
    let context = '';
    if (herbFromDb) {
      context = `\n\nDatabáze obsahuje záznam pro tuto bylinu:\n\`\`\`json\n${JSON.stringify(herbFromDb, null, 2)}\n\`\`\`\nMůžeš se na něj odkázat a doplnit ho.`;
    }

    return `Uživatelka se ptá na bylinu/doplněk: **"${query}"**

Dej strukturovaný profil:

**🌿 Ájurvéda:** rasa, virya, vipaka, vliv na dóši, klasifikace (rasayana, balya, ...)
**🀄 TCM:** termická povaha, chuť, dráhy, akce
**🔬 Moderní výzkum:** klíčové účinné látky, doložené účinky, kvalita důkazů
**📋 Indikace:** na co se používá
**⚠️ Kontraindikace:** kdy NE
**💊 Lékové interakce:** klinicky relevantní (warfarin, antidepresiva, antikoncepce, atd.)
**💧 Dávkování:** standardní rozsah
**👤 Pro tebe konkrétně:** vhodné/opatrně/vyhnout se vzhledem k profilu + proč
**📚 Zdroje:** klíčové reference (Charaka, Bensky, recentní studie...)

Pokud o bylině nemáš spolehlivé informace, řekni to.${context}`;
  }

  function buildCombineCheckPrompt(items, profile) {
    return `Uživatelka se ptá, jestli může kombinovat: **${items.join(', ')}**

Projdi tři vrstvy:

**1. Ájurvédské Viruddha Ahara** (klasické nekompatibility):
- mléko + ovoce, mléko + ryby, mléko + meloun, mléko + sůl
- med + horká voda nad 40 °C (toxické)
- studené nápoje + teplé jídlo
- syrová a vařená potravina dohromady
- nepravidelné kombinace chutí

**2. TCM kombinační pravidla:**
- chladná + studená povaha = uhašení Sleziny
- ovoce po hlavním jídle = kvašení (Tan, Shi)
- těžké luštěniny + maso = stagnace
- syrové saláty po obilovinách = paralýza Agni/Sleziny

**3. Bylinné a farmakologické interakce** (pokud jsou v seznamu byliny nebo léky):
- konkrétní bylina × bylina
- bylina × jídlo (např. mléko ruší kurkumu bez tuku)
- bylina × lék

Pro každou problematickou kombinaci řekni:
- ❌ ČERVENÁ — vyhnout se
- ⚠️ ŽLUTÁ — opatrně, s úpravou
- ✅ ZELENÁ — OK

A pro Zuzanu konkrétně: vzhledem k jejímu profilu (slabá Slezina, Vlhká Horkost), je tato kombinace teď bezpečná?`;
  }

  function buildAnalyzePrompt(problem) {
    return `Uživatelka popisuje: **"${problem}"**

Analyzuj přes tři optiky:

**🌿 Ájurvéda**
- Jakou dóšu/dóši to ukazuje?
- Jaká je dhatu (tkáň), srotas (kanál), agni?
- Co to znamená v jejím konkrétním kontextu?

**🀄 TCM**
- Jaký vzorec? (deficit/nadbytek, který orgán, jaký patogen)
- Jak to zapadá do jejího hlavního obrazu (Slezina, Vlhkost, Játra, Yin)?

**🧠 Psychosomatika**
- Jaký emoční / životní vzorec se za tím může skrývat?
- Vychází z Maté / van der Kolk / Levine / Sarno...

**💡 Souhrnná rada**
- 2-3 konkrétní praktické kroky
- Co bylin/potravin přidat, co vynechat
- Co dál sledovat

**⚠️ Kdy k lékaři:** pokud je tam red flag, vždy ho zmiň.

Pamatuj: označuj návrhy a domněnky.`;
  }

  // Expose to window
  window.GeminiClient = GeminiClient;
  window.buildSystemPrompt = buildSystemPrompt;
  window.buildFoodLookupPrompt = buildFoodLookupPrompt;
  window.buildHerbLookupPrompt = buildHerbLookupPrompt;
  window.buildCombineCheckPrompt = buildCombineCheckPrompt;
  window.buildAnalyzePrompt = buildAnalyzePrompt;

})();
