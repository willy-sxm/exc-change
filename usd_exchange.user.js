// ==UserScript==
// @name         Hiboutik EXC-Change (USD 1:1)
// @namespace    http://tampermonkey.net/
// @version      5.7
// @description  EXC-Change v5.7: bottone CARTE usa iframe nascosto · zero navigazione · toast verde/rosso
// @author       Willy Ravanini – Tropical Tech Properties
// @match        https://lipstick.hiboutik.com/*
// @match        https://cartescadeaux.hiboutik.net/*
// @updateURL    https://raw.githubusercontent.com/willy-sxm/exc-change/main/usd_exchange.user.js
// @downloadURL  https://raw.githubusercontent.com/willy-sxm/exc-change/main/usd_exchange.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const HOST = location.hostname;
    const LOG  = (...a) => console.log('%c[EXC]', 'color:#28a745;font-weight:bold', ...a);
    const WARN = (...a) => console.warn('%c[EXC]', 'color:#f0a500;font-weight:bold', ...a);

    // ── Configurazione fissa (non sensibile) ─────────────────────────────────
    const API_BASE               = 'https://lipstick.hiboutik.com/api';
    const GC_PRODUCT_ID          = 6613;  // Prodotto "Carte Cadeau" in Hiboutik
    const STORE_ID_DEFAULT       = '4';   // Marigot (usato per POST /sales)
    const PAYMENT_TYPE_BOUTIQUE  = '3';   // Boutique ID per GET /api/payment_types/
    const VENDOR_ID_DEFAULT      = '16';  // fallback (non usato se EUR sale letto correttamente)

    // ── Credenziali API — salvate localmente, MAI nel codice ─────────────────
    // Primo avvio: popup di setup. Reset: EXC_resetCredentials() in console.
    function getCredentials() {
        return {
            user: GM_getValue('exc_api_user', ''),
            key:  GM_getValue('exc_api_key',  '')
        };
    }

    function showSetupModal() {
        return new Promise((resolve) => {
            document.getElementById('exc-setup-overlay')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'exc-setup-overlay';
            overlay.style.cssText =
                'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:999999;' +
                'display:flex;align-items:center;justify-content:center';
            overlay.innerHTML = `
              <div style="background:#fff;border-radius:12px;padding:32px 36px;width:420px;
                          font-family:system-ui,Arial;box-shadow:0 12px 48px rgba(0,0,0,.4)">
                <div style="font-size:36px;text-align:center;margin-bottom:8px">🔑</div>
                <h3 style="margin:0 0 4px;color:#6610f2;text-align:center">EXC-Change — Configuration</h3>
                <p style="margin:0 0 20px;font-size:12px;color:#888;text-align:center">
                  Les identifiants sont sauvegardés localement sur ce PC.<br>
                  Ils ne sont jamais envoyés ailleurs.
                </p>
                <label style="font-size:12px;font-weight:bold;color:#444;display:block;margin-bottom:4px">
                  Email Hiboutik
                </label>
                <input id="exc-setup-user" type="email" placeholder="email@exemple.com"
                  style="width:100%;box-sizing:border-box;padding:10px 12px;border:2px solid #dee2e6;
                         border-radius:6px;font-size:14px;margin-bottom:12px;outline:none">
                <label style="font-size:12px;font-weight:bold;color:#444;display:block;margin-bottom:4px">
                  Clé API Hiboutik
                </label>
                <input id="exc-setup-key" type="password" placeholder="Clé API (Hiboutik → Mon compte → API)"
                  style="width:100%;box-sizing:border-box;padding:10px 12px;border:2px solid #dee2e6;
                         border-radius:6px;font-size:14px;margin-bottom:20px;outline:none">
                <button id="exc-setup-save" type="button"
                  style="width:100%;padding:12px;border:none;background:#6610f2;color:#fff;
                         border-radius:8px;cursor:pointer;font-weight:bold;font-size:15px">
                  ✅ Sauvegarder et continuer
                </button>
                <p style="margin:12px 0 0;font-size:11px;color:#aaa;text-align:center">
                  Pour réinitialiser : taper <code>EXC_resetCredentials()</code> dans la console
                </p>
              </div>`;
            document.body.appendChild(overlay);

            const uInput = overlay.querySelector('#exc-setup-user');
            const kInput = overlay.querySelector('#exc-setup-key');
            setTimeout(() => uInput.focus(), 50);

            overlay.querySelector('#exc-setup-save').onclick = () => {
                const u = uInput.value.trim();
                const k = kInput.value.trim();
                if (!u || !k) {
                    [uInput, kInput].forEach(el => {
                        if (!el.value.trim()) el.style.borderColor = '#dc3545';
                    });
                    return;
                }
                GM_setValue('exc_api_user', u);
                GM_setValue('exc_api_key',  k);
                overlay.remove();
                LOG('✅ Credenziali salvate per', u);
                resolve({ user: u, key: k });
            };
        });
    }

    // Esposto globalmente per reset da console
    window.EXC_resetCredentials = () => {
        GM_deleteValue('exc_api_user');
        GM_deleteValue('exc_api_key');
        LOG('🔑 Credenziali cancellate — ricarica la pagina per reinserirle');
    };

    // ── Helper API Hiboutik (Basic Auth, form-encoded) ────────────────────────
    async function hiboutikAPI(method, path, data) {
        const { user, key } = getCredentials();
        const auth = btoa(`${user}:${key}`);
        const opts = { method, headers: { 'Authorization': `Basic ${auth}` } };
        if (data && method !== 'GET') {
            opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            opts.body = new URLSearchParams(data).toString();
        }
        const res  = await fetch(`${API_BASE}${path}`, opts);
        const text = await res.text();
        LOG(`API ${method} ${path} → ${res.status}: ${text.slice(0, 120)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        try { return JSON.parse(text); } catch { return text; }
    }

    // ── Helper setVal: compatibile AngularJS (execCommand + fallback) ─────────
    function setVal(input, value) {
        input.focus();
        try {
            input.select();
            if (document.execCommand('insertText', false, String(value))) {
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }
        } catch (_) {}
        try {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
                  .set.call(input, String(value));
        } catch (_) { input.value = String(value); }
        ['input', 'change', 'blur'].forEach(ev =>
            input.dispatchEvent(new Event(ev, { bubbles: true, cancelable: true }))
        );
    }

    // ── Check credenziali all'avvio ───────────────────────────────────────────
    async function ensureCredentials() {
        const { user, key } = getCredentials();
        if (!user || !key) {
            LOG('🔑 Credenziali mancanti — mostro setup');
            await showSetupModal();
        } else {
            LOG('🔑 Credenziali caricate per:', user);
        }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // BRANCH: cartescadeaux.hiboutik.net
    // Usato SOLO dal bottone 🎁 CARTE per applicare manualmente una gift card (Utiliser).
    // ════════════════════════════════════════════════════════════════════════════
    if (HOST === 'cartescadeaux.hiboutik.net') {
        const LG = (...a) => console.log('%c[EXC iframe]', 'color:#6610f2;font-weight:bold', ...a);

        const step = GM_getValue('exc_iframe_step', '');
        const code = GM_getValue('exc_pending_code', null);

        LG('Init | step:', step, '| code:', code);

        // Solo step='utiliser' è gestito — per qualsiasi altro stato l'iframe è libero
        if (step !== 'utiliser' || !code) {
            LG('Nessuna azione automatica (step:', step, ')');
            return;
        }

        // Banner informativo
        function showBanner(html, color) {
            document.getElementById('exc-banner')?.remove();
            const b = document.createElement('div');
            b.id = 'exc-banner';
            b.style.cssText =
                `position:fixed;top:0;left:0;right:0;background:${color};color:#fff;` +
                'padding:10px 16px;font-family:system-ui,Arial;font-weight:bold;' +
                'text-align:center;z-index:99999;font-size:13px;line-height:1.5;' +
                'box-shadow:0 2px 8px rgba(0,0,0,.25)';
            b.innerHTML = html;
            document.body.appendChild(b);
            setTimeout(() => b.remove(), 12000);
        }

        function findHeading(keyword) {
            return Array.from(document.querySelectorAll(
                'h1,h2,h3,h4,h5,legend,.panel-title,.card-title,.panel-heading'
            )).find(el => new RegExp(keyword, 'i').test(el.textContent || ''));
        }

        // Trova il container padre che contiene l'heading (form, .panel, .card, section, div)
        function findSectionContainer(heading) {
            let el = heading.parentElement;
            for (let i = 0; i < 8; i++) {
                if (!el || el === document.body) break;
                const inputs = el.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])');
                const btns   = el.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type="button"])');
                if (inputs.length > 0 && btns.length > 0) return el;
                el = el.parentElement;
            }
            return null;
        }

        // Riempie il form "Utiliser une carte cadeau" e clicca Valider
        // Selettori precisi: form con hidden action=use_cc → input#code_cc → button[type=submit]
        function tryFillUtiliser(retries) {
            retries = retries || 0;
            if (retries > 60) {
                LG('Form Utiliser non trovato dopo 60 tentativi');
                GM_setValue('exc_error', 'Form Utiliser non trovato');
                GM_deleteValue('exc_pending_code');
                GM_deleteValue('exc_iframe_step');
                return;
            }

            // Trova il form Utiliser tramite il campo hidden action=use_cc
            const utiliserForm = document.querySelector(
                'form input[name="action"][value="use_cc"]'
            )?.closest('form');
            if (!utiliserForm) { setTimeout(() => tryFillUtiliser(retries + 1), 300); return; }

            const codeInput  = utiliserForm.querySelector('#code_cc') ||
                               utiliserForm.querySelector('input[type="text"]');
            const validerBtn = utiliserForm.querySelector('button[type="submit"]');

            if (!codeInput || !validerBtn) {
                setTimeout(() => tryFillUtiliser(retries + 1), 300);
                return;
            }

            LG('✅ Form Utiliser trovato | input:', codeInput.id, '| btn:', validerBtn.textContent?.trim());

            // Cleanup GM prima del submit
            GM_deleteValue('exc_pending_code');
            GM_deleteValue('exc_iframe_step');

            codeInput.value = code;
            codeInput.dispatchEvent(new Event('input', { bubbles: true }));

            setTimeout(() => {
                codeInput.value = code; // re-set sicurezza
                LG('🤖 Click Valider | code:', code);
                validerBtn.click();

                // Observer: rileva successo O errore → segnala pagina principale
                let signaled = false;
                const obs = new MutationObserver(() => {
                    if (signaled) return;

                    // Successo
                    const ok = document.querySelector('.alert-success, [class*="alert-success"]');
                    if (ok && /utilisée|appliqué|succès|success/i.test(ok.textContent || '')) {
                        signaled = true; obs.disconnect();
                        LG('✅ Utiliser completato!');
                        GM_setValue('exc_completed', JSON.stringify({ code }));
                        return;
                    }
                    // Errore (es. "Carte cadeau inexistante")
                    const err = document.querySelector('.alert-danger, [class*="alert-danger"]');
                    if (err && err.textContent?.trim()) {
                        signaled = true; obs.disconnect();
                        LG('❌ Errore Utiliser:', err.textContent.trim());
                        GM_setValue('exc_error', err.textContent.trim());
                    }
                });
                obs.observe(document.body, { childList: true, subtree: true });

                // Safety timeout 8s
                setTimeout(() => {
                    if (!signaled) {
                        signaled = true; obs.disconnect();
                        // Controlla un'ultima volta prima di dare errore generico
                        const err = document.querySelector('.alert-danger');
                        if (err?.textContent?.trim()) {
                            GM_setValue('exc_error', err.textContent.trim());
                        } else {
                            GM_setValue('exc_completed', JSON.stringify({ code }));
                        }
                    }
                }, 8000);
            }, 600);
        }

        if (document.readyState === 'complete') tryFillUtiliser(0);
        else window.addEventListener('load', () => tryFillUtiliser(0));
        return;
    }

    // ════════════════════════════════════════════════════════════════════════════
    // BRANCH PRINCIPALE: lipstick.hiboutik.com
    // ════════════════════════════════════════════════════════════════════════════

    // ── Lettura dati dalla pagina ─────────────────────────────────────────────
    function getSaleId() {
        const fromNumpad = document.querySelector('#numpad input[name="ma_commande_affiche"]');
        if (fromNumpad?.value) return fromNumpad.value;
        const p = new URLSearchParams(window.location.search);
        const fromQ = p.get('id_vente') || p.get('sale_id') || p.get('id');
        if (fromQ) return fromQ;
        const m = (window.location.hash + window.location.pathname).match(/sale[/_-]?(\d+)/i);
        if (m) return m[1];
        const hidden = document.querySelector(
            'input[name="id_vente"], input[name="sale_id"], [data-sale-id], [data-id-vente]'
        );
        return hidden?.value || hidden?.dataset?.saleId || hidden?.dataset?.idVente || null;
    }

    function getNumpadAmount() {
        const raw = document.querySelector('#numpad input[name="montant_paiement_type"]')?.value
                 || document.querySelector('#numpad input[name="montant"]')?.value
                 || '0';
        return parseFloat(String(raw).replace(',', '.'));
    }

    function getStoreId() {
        const el = document.querySelector('[data-store-id],[data-boutique-id],input[name="store_id"]');
        if (el?.value) return el.value;
        return new URLSearchParams(location.search).get('store_id') || STORE_ID_DEFAULT;
    }

    function getVendorId() {
        const el = document.querySelector('[data-vendor-id],[data-id-vendor],input[name="vendor_id"]');
        if (el?.value) return el.value;
        return new URLSearchParams(location.search).get('vendor_id') || VENDOR_ID_DEFAULT;
    }

    // ── Modal scelta metodo USD ───────────────────────────────────────────────
    function askUSDMethod(amount) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText =
                'position:fixed;inset:0;background:rgba(0,0,0,.55);' +
                'z-index:99999;display:flex;align-items:center;justify-content:center';

            const btnStyle =
                'flex:1 1 40%;padding:14px 8px;background:#fff;border-radius:6px;' +
                'cursor:pointer;font-size:13px;font-weight:bold;min-width:100px';

            overlay.innerHTML = `
              <div style="background:#fff;border-radius:10px;padding:24px 28px;width:360px;
                          font-family:system-ui,Arial,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.3)">
                <h3 style="margin:0 0 6px;color:#28a745">💵 Come paga in USD?</h3>
                <p style="margin:0 0 16px;color:#555;font-size:13px">
                  Importo: <b>${amount.toFixed(2)} USD</b>
                </p>
                <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:16px">
                  <button data-method="CASH" type="button" style="${btnStyle};border:2px solid #28a745;color:#28a745">
                    💵 CASH<br><small style="font-weight:normal;color:#555">Espèces USD</small></button>
                  <button data-method="CBUS" type="button" style="${btnStyle};border:2px solid #0d6efd;color:#0d6efd">
                    💳 CBUS<br><small style="font-weight:normal;color:#555">Carte USD</small></button>
                  <button data-method="AMXU" type="button" style="${btnStyle};border:2px solid #6c757d;color:#6c757d">
                    🔵 AMXU<br><small style="font-weight:normal;color:#555">Amex USD</small></button>
                </div>
                <div style="text-align:right">
                  <button id="exc-cancel" type="button"
                    style="padding:7px 14px;border:1px solid #ccc;background:#fff;
                           border-radius:6px;cursor:pointer">Annulla</button>
                </div>
              </div>`;

            document.body.appendChild(overlay);
            overlay.querySelectorAll('[data-method]').forEach(btn => {
                btn.onclick = () => { overlay.remove(); resolve(btn.dataset.method); };
            });
            overlay.querySelector('#exc-cancel').onclick = () => { overlay.remove(); resolve(null); };
        });
    }

    // ── Overlay di elaborazione ───────────────────────────────────────────────
    function showProcessingOverlay(amount, method) {
        document.getElementById('exc-processing')?.remove();
        const d = document.createElement('div');
        d.id = 'exc-processing';
        d.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;' +
            'display:flex;align-items:center;justify-content:center';
        d.innerHTML = `
          <div style="background:#fff;border-radius:12px;padding:32px 40px;text-align:center;
                      font-family:system-ui,Arial;box-shadow:0 12px 48px rgba(0,0,0,.35)">
            <div style="font-size:40px;margin-bottom:12px">⏳</div>
            <h3 style="margin:0 0 8px;color:#6610f2">EXC-Change — Elaborazione</h3>
            <p style="margin:0;color:#555;font-size:14px">
              Creo vendita USD <b>${amount.toFixed(2)} ${method}</b>...<br>
              <small style="color:#888">Attendi, non chiudere la pagina</small>
            </p>
          </div>`;
        document.body.appendChild(d);
        return d;
    }

    // ── Popup conferma finale ─────────────────────────────────────────────────
    function showFinalConfirmation(usdSaleId, amount, method, avoirCode) {
        document.getElementById('exc-processing')?.remove();
        const overlay = document.createElement('div');
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,.5);' +
            'z-index:99999;display:flex;align-items:center;justify-content:center';
        overlay.innerHTML = `
          <div style="background:#fff;border-radius:12px;padding:28px 32px;width:420px;
                      font-family:system-ui,Arial;box-shadow:0 12px 48px rgba(0,0,0,.35);text-align:center">
            <div style="font-size:52px;margin-bottom:10px">✅</div>
            <h3 style="margin:0 0 8px;color:#28a745;font-size:20px">Paiement USD enregistré</h3>
            <div style="background:#f6f8fa;padding:12px;border-radius:8px;font-size:13px;
                        line-height:1.8;margin-bottom:16px;text-align:left">
              <b>Vente USD :</b> #${usdSaleId}<br>
              <b>Montant :</b> ${parseFloat(amount).toFixed(2)} USD<br>
              <b>Méthode :</b> ${method}<br>
              <b>Avoir appliqué :</b> <code>${avoirCode}</code>
            </div>
            <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;
                        padding:10px 14px;font-size:13px;color:#795548;margin-bottom:20px">
              ⚠️ La vente EUR est encore ouverte.<br>
              Vous pouvez modifier, puis <b>clôturer manuellement</b>.
            </div>
            <button id="exc-done" type="button"
              style="padding:12px 36px;border:none;background:#28a745;color:#fff;
                     border-radius:8px;cursor:pointer;font-weight:bold;font-size:16px">
              OK — Continuer ✓
            </button>
          </div>`;
        document.body.appendChild(overlay);
        document.getElementById('exc-done').onclick = () => overlay.remove();
    }

    function showError(msg) {
        document.getElementById('exc-processing')?.remove();
        alert(`❌ EXC-Change — Errore:\n\n${msg}\n\nControlla la console [EXC] per i dettagli.`);
    }

    // ── FLUSSO PRINCIPALE USD v5.1 — Avoir (credit note) ────────────────────────
    //
    // 0. GET  /api/sales/{saleId}          leggo vendor_id dalla vendita EUR
    // 1. POST /api/sales/                  currency_code=USD, vendor_id ereditato → usdSaleId
    // 2. POST /api/sales/add_product/      prodotto 6613, stock_withdrawal=1 → line_item_id
    // 3. POST /api/sales_payment_div/      metodo CASH|CBUS|AMXU
    // 4. POST /api/sales/close/            chiude vendita USD
    // 5. PUT  /api/sale_line_item_exchange/{line_item_id}/0/  body={} → genera avoir
    // 6. GET  /api/credit_notes/{store_id} → recupera codice avoir più recente
    // 7. POST /api/sales/add_credit_note/  sale_id=EUR, credit_note_code=code
    // 8. POST /api/sales/close/            chiude vendita EUR
    //
    // Risultato: USD sale con stesso vendor EUR + EUR chiusa con avoir = zero revenue duplicata
    //
    async function processUSDPayment(saleId, amountUSD, method) {
        const amount    = parseFloat(amountUSD);
        const amountStr = amount.toFixed(2);

        LOG('🚀 Flusso USD v5.1 (avoir) | EUR sale:', saleId, '| amount:', amountStr, '| method:', method);

        // ── STEP 0: Leggo vendor_id dalla vendita EUR ─────────────────────────
        LOG('📋 Step 0 — Leggo vendor_id dalla vendita EUR', saleId, '...');
        let vendorId = getVendorId(); // fallback DOM
        try {
            const eurSale = await hiboutikAPI('GET', `/sales/${saleId}`, null);
            const raw = eurSale?.vendor_id
                     || eurSale?.[0]?.vendor_id
                     || eurSale?.sale?.vendor_id;
            if (raw) { vendorId = String(raw); LOG('✅ vendor_id letto dalla vendita EUR:', vendorId); }
            else { WARN('vendor_id non trovato nella risposta EUR sale — uso fallback DOM:', vendorId); }
        } catch (e) {
            WARN('Impossibile leggere EUR sale — uso fallback DOM:', vendorId, '| err:', e.message);
        }

        showProcessingOverlay(amount, method);

        try {
            // ── STEP 1: Crea vendita USD ──────────────────────────────────────
            LOG('📋 Step 1 — Creo vendita USD (store:', STORE_ID_DEFAULT, ')...');
            const saleRes = await hiboutikAPI('POST', '/sales/', {
                store_id:      STORE_ID_DEFAULT,
                currency_code: 'USD',
                vendor_id:     vendorId
            });
            const usdSaleId = saleRes?.sale_id || saleRes?.[0]?.sale_id;
            if (!usdSaleId) throw new Error('sale_id USD non ricevuto: ' + JSON.stringify(saleRes));
            LOG('✅ Vendita USD creata → sale_id:', usdSaleId);

            // ── STEP 2: Aggiungi prodotto GC → ottieni line_item_id ───────────
            LOG('📋 Step 2 — Aggiungo prodotto', GC_PRODUCT_ID, 'a vendita USD (stock_withdrawal=1)...');
            const productRes = await hiboutikAPI('POST', '/sales/add_product/', {
                sale_id:          usdSaleId,
                product_id:       GC_PRODUCT_ID,
                product_price:    amountStr,
                quantity:         1,
                stock_withdrawal: 1
            });
            // line_item_id può essere in vari campi a seconda versione API
            const lineItemId = productRes?.id_sale_product_detail
                            || productRes?.[0]?.id_sale_product_detail
                            || productRes?.sale_line_item_id
                            || productRes?.[0]?.sale_line_item_id
                            || productRes?.id
                            || productRes?.[0]?.id;
            if (!lineItemId) throw new Error('line_item_id non ricevuto: ' + JSON.stringify(productRes));
            LOG('✅ Prodotto GC aggiunto → line_item_id:', lineItemId);

            // ── STEP 3: Pagamento USD ─────────────────────────────────────────
            LOG('📋 Step 3 — Registro pagamento USD:', method, amountStr);
            await hiboutikAPI('POST', '/sales_payment_div/', {
                sale_id:        usdSaleId,
                payment_type:   method,
                payment_amount: amountStr
            });
            LOG('✅ Pagamento USD registrato');

            // ── STEP 4: Chiudi vendita USD ────────────────────────────────────
            LOG('📋 Step 4 — Chiudo vendita USD', usdSaleId);
            await hiboutikAPI('POST', '/sales/close/', { sale_id: usdSaleId });
            LOG('✅ Vendita USD chiusa');

            // ── STEP 5: Exchange line item → genera avoir ─────────────────────
            // NOTA: Hiboutik richiede Content-Type anche con body vuoto → passare {} non null
            // La risposta contiene direttamente avoir_id → non serve Step 6 separato
            LOG('📋 Step 5 — Exchange line_item', lineItemId, '→ genero avoir...');
            const exchangeRes = await hiboutikAPI('PUT', `/sale_line_item_exchange/${lineItemId}/0/`, {});
            LOG('✅ Exchange eseguito → risposta:', JSON.stringify(exchangeRes));

            // ── STEP 6: Estrai codice avoir ───────────────────────────────────
            // Primo tentativo: avoir_id è già nella risposta Step 5
            let creditNoteCode = exchangeRes?.avoir_id
                              || exchangeRes?.credit_note_code
                              || exchangeRes?.code;

            if (!creditNoteCode) {
                // Fallback: GET /credit_notes/ e prendo il più recente
                LOG('📋 Step 6 fallback — avoir_id non in risposta, recupero credit notes...');
                await new Promise(r => setTimeout(r, 1200));
                const creditNotes = await hiboutikAPI('GET', `/credit_notes/${STORE_ID_DEFAULT}`, null);
                if (!Array.isArray(creditNotes) || creditNotes.length === 0)
                    throw new Error('Nessun avoir trovato. Risposta: ' + JSON.stringify(creditNotes));
                // Campo reale: "credit_note" (non credit_note_code)
                const sorted = [...creditNotes].sort((a, b) => {
                    const idA = parseInt(a.credit_note || a.credit_note_id || a.id || 0, 10);
                    const idB = parseInt(b.credit_note || b.credit_note_id || b.id || 0, 10);
                    return idB - idA;
                });
                const newest = sorted[0];
                creditNoteCode = newest.credit_note || newest.credit_note_code || newest.credit_note_id;
                if (!creditNoteCode) throw new Error('credit_note_code non trovato: ' + JSON.stringify(newest));
            }
            LOG('✅ Avoir code:', creditNoteCode);

            // ── STEP 7: Applica avoir alla vendita EUR ────────────────────────
            LOG('📋 Step 7 — Applico avoir', creditNoteCode, 'a vendita EUR', saleId);
            await hiboutikAPI('POST', '/sales/add_credit_note/', {
                sale_id:          saleId,
                credit_note_code: creditNoteCode
            });
            LOG('✅ Avoir applicato alla vendita EUR');

            // ── Step 8 rimosso: la vendita EUR viene chiusa manualmente dal cassiere ──
            // Il cassiere può ancora aggiungere prodotti o modificare prima di chiudere.

            // ── Conferma ─────────────────────────────────────────────────────
            showFinalConfirmation(usdSaleId, amountStr, method, creditNoteCode);
            LOG('🎉 USD completato | USD sale:', usdSaleId, '| EUR sale:', saleId,
                '| method:', method, '| avoir:', creditNoteCode, '| chiusura EUR: manuale');

        } catch (e) {
            WARN('❌ Errore flusso USD v5.0:', e.message);
            showError(e.message);
        }
    }

    // ── Trova bottone "Cartes cadeaux" nella sidebar ──────────────────────────
    function findCartesCadeauxBtn() {
        const byText = Array.from(document.querySelectorAll('a, button, [role="button"]')).find(el => {
            const txt = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
            return txt === 'cartes cadeaux' || txt.startsWith('cartes cadeaux');
        });
        if (byText) return byText;
        return document.querySelector(
            'a[href*="cartes_cadeaux"], a[href*="gift_card"], ' +
            '[id*="carte"][id*="cadeau" i], [class*="cartes-cadeaux"]'
        );
    }

    // ── Popup bottone 🎁 CARTE (Utiliser via iframe nascosto) ────────────────
    // 1. Cassiere inserisce codice gift card
    // 2. Script legge URL cartescadeaux da input[name="url_btn"]
    // 3. Crea iframe fuori schermo → branch cartescadeaux auto-compila e clicca
    // 4. Poller rileva exc_completed (✅) o exc_error (❌) → rimuove iframe → toast
    function showGiftCardPopup(saleId) {
        if (!saleId) { alert('❌ Sale ID non trovato. Apri prima una vendita.'); return; }
        if (document.getElementById('exc-gc-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'exc-gc-overlay';
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,.55);' +
            'z-index:99999;display:flex;align-items:center;justify-content:center';

        overlay.innerHTML = `
          <div style="background:#fff;border-radius:10px;padding:24px 28px;width:400px;
                      font-family:system-ui,Arial;box-shadow:0 10px 40px rgba(0,0,0,.3)">
            <h3 style="margin:0 0 6px;color:#6610f2">🎁 Utiliser une carte cadeau</h3>
            <p style="margin:0 0 16px;font-size:12px;color:#666">Vendita <b>#${saleId}</b></p>
            <label style="font-size:13px;color:#444;font-weight:bold;display:block;margin-bottom:6px">
              Code carte cadeau (S/N)
            </label>
            <input id="exc-gc-code" type="text"
              placeholder="ex: 117482hi176001"
              style="width:100%;box-sizing:border-box;padding:11px 12px;border:2px solid #6610f2;
                     border-radius:6px;font-size:15px;outline:none;margin-bottom:8px">
            <p style="font-size:11px;color:#888;margin:0 0 16px">
              Inserisci il codice S/N → applica automaticamente senza aprire la pagina.
            </p>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button id="exc-gc-cancel" type="button"
                style="padding:9px 18px;border:1px solid #ccc;background:#fff;
                       border-radius:6px;cursor:pointer;font-size:14px">Annulla</button>
              <button id="exc-gc-apply" type="button"
                style="padding:9px 22px;border:none;background:#6610f2;color:#fff;
                       border-radius:6px;cursor:pointer;font-weight:bold;font-size:14px">
                ✅ Applica
              </button>
            </div>
          </div>`;

        document.body.appendChild(overlay);

        const codeInput = overlay.querySelector('#exc-gc-code');
        setTimeout(() => codeInput.focus(), 50);

        overlay.querySelector('#exc-gc-apply').onclick = () => {
            const code = codeInput.value.trim();
            if (!code) { codeInput.style.borderColor = '#dc3545'; codeInput.focus(); return; }

            // Legge URL iframe da input[name="url_btn"] (bottone "Cartes cadeaux" nella pagina)
            const urlBtn = document.querySelector('input[name="url_btn"]');
            if (!urlBtn?.value) {
                alert('❌ URL Cartes cadeaux non trovato.\nAssicurati di essere nella pagina di pagamento.');
                return;
            }

            overlay.remove();
            LOG('🎁 Iframe nascosto | code:', code, '| URL:', urlBtn.value.slice(0, 80));

            // Prepara comunicazione cross-domain
            GM_deleteValue('exc_completed');
            GM_deleteValue('exc_error');
            GM_setValue('exc_pending_code', code);
            GM_setValue('exc_iframe_step', 'utiliser');

            // Iframe fuori schermo — il cassiere non lo vede mai
            const iframe = document.createElement('iframe');
            iframe.src = urlBtn.value;
            iframe.style.cssText =
                'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;';
            document.body.appendChild(iframe);

            // Spinner di attesa
            const spinner = document.createElement('div');
            spinner.id = 'exc-gc-spinner';
            spinner.style.cssText =
                'position:fixed;bottom:24px;right:24px;background:#6610f2;color:#fff;' +
                'padding:12px 20px;border-radius:10px;font-family:system-ui;font-weight:bold;' +
                'font-size:14px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.3)';
            spinner.textContent = '⏳ Application en cours…';
            document.body.appendChild(spinner);

            function cleanup() {
                iframe.remove();
                spinner.remove();
                GM_deleteValue('exc_completed');
                GM_deleteValue('exc_error');
                GM_deleteValue('exc_pending_code');
                GM_deleteValue('exc_iframe_step');
            }

            // Poller: attende exc_completed o exc_error dal branch cartescadeaux
            const poll = setInterval(() => {
                const done  = GM_getValue('exc_completed', null);
                const error = GM_getValue('exc_error', null);
                if (!done && !error) return;

                clearInterval(poll);
                clearTimeout(safetyTimer);
                cleanup();

                const n = document.createElement('div');
                if (done) {
                    LOG('✅ Gift card applicata | code:', code);
                    n.style.cssText =
                        'position:fixed;bottom:24px;right:24px;background:#28a745;color:#fff;' +
                        'padding:14px 22px;border-radius:10px;font-family:system-ui;font-weight:bold;' +
                        'font-size:14px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.3)';
                    n.innerHTML = `✅ Carte <code style="background:rgba(255,255,255,.2);` +
                        `padding:2px 6px;border-radius:4px">${code}</code> appliquée !`;
                    setTimeout(() => n.remove(), 5000);
                } else {
                    WARN('❌ Errore Utiliser:', error);
                    n.style.cssText =
                        'position:fixed;bottom:24px;right:24px;background:#dc3545;color:#fff;' +
                        'padding:14px 22px;border-radius:10px;font-family:system-ui;font-weight:bold;' +
                        'font-size:14px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.3)';
                    n.innerHTML = `❌ Erreur : <span style="font-weight:normal">${error}</span>`;
                    setTimeout(() => n.remove(), 8000);
                }
                document.body.appendChild(n);
            }, 500);

            // Safety timeout 60s
            const safetyTimer = setTimeout(() => {
                clearInterval(poll);
                cleanup();
                WARN('❌ Timeout iframe Utiliser (60s)');
                alert('❌ Timeout: carte cadeau non applicata.\nVerifica il codice e riprova.');
            }, 60000);
        };

        overlay.querySelector('#exc-gc-cancel').onclick = () => overlay.remove();
        codeInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') overlay.querySelector('#exc-gc-apply').click();
        });
    }

    // ── Discovery: log tipi pagamento configurati (debug, non blocca) ─────────
    async function discoverPaymentTypes() {
        try {
            const data = await hiboutikAPI('GET', `/payment_types/${PAYMENT_TYPE_BOUTIQUE}`, null);
            if (Array.isArray(data)) {
                const usd = data.filter(t => t.currency === 'USD' && t.enabled);
                const eur = data.filter(t => t.currency === 'EUR' && t.enabled);
                LOG('💳 USD abilitati:', usd.map(t => t.payment_type).join(', '));
                LOG('💳 EUR abilitati:', eur.map(t => t.payment_type).join(', '));
            }
        } catch (e) {
            WARN('Discovery payment_types:', e.message);
        }
    }

    // ── Iniezione bottoni ─────────────────────────────────────────────────────

    // Trova il bottone "Ouverture tiroir" per ancorare i nostri bottoni sotto di lui
    function findOuvertureTiroir() {
        return Array.from(document.querySelectorAll('button, a')).find(el =>
            /ouverture.{0,6}tiroir/i.test(el.textContent || '')
        );
    }

    function shouldShow() {
        return !!(findOuvertureTiroir() ||
                  document.querySelector('div.boutons_payement_numpad, button[id^="btn_paiement_"]'));
    }

    // Stile coerente con gli altri bottoni del pannello destro di Hiboutik
    const BTN_BASE =
        'display:block;width:100%;padding:10px 16px;margin-top:6px;' +
        'border-radius:6px;cursor:pointer;font-weight:bold;font-size:14px;' +
        'text-align:center;border:2px solid;';

    function injectUSDButton() {
        if (document.getElementById('exc-usd-btn')) return;
        const anchor = findOuvertureTiroir();
        if (!anchor) return;

        const btn = document.createElement('button');
        btn.id        = 'exc-usd-btn';
        btn.type      = 'button';
        btn.innerHTML = '💵 EXC — Paiement USD';
        btn.style.cssText = BTN_BASE +
            'background:#28a745;color:#fff;border-color:#28a745;';

        btn.onclick = async () => {
            const saleId = getSaleId();
            if (!saleId) { alert('❌ Sale ID non trovato.'); return; }
            const amount = getNumpadAmount();
            if (!isFinite(amount) || amount <= 0) {
                alert('❌ Inserisci un importo sul tastierino prima di cliccare USD.');
                return;
            }
            const method = await askUSDMethod(amount);
            if (!method) return;
            btn.disabled  = true;
            btn.innerHTML = '⏳ Traitement…';
            try   { await processUSDPayment(saleId, amount, method); }
            finally { btn.disabled = false; btn.innerHTML = '💵 EXC — Paiement USD'; }
        };

        anchor.insertAdjacentElement('afterend', btn);
        LOG('Bottone 💵 USD iniettato dopo Ouverture tiroir');
    }

    function injectGiftCardButton() {
        if (document.getElementById('exc-gc-btn')) return;
        const usdBtn = document.getElementById('exc-usd-btn');
        const anchor = usdBtn || findOuvertureTiroir();
        if (!anchor) return;

        const btn = document.createElement('button');
        btn.id        = 'exc-gc-btn';
        btn.type      = 'button';
        btn.innerHTML = '🎁 Utiliser carte cadeau';
        btn.style.cssText = BTN_BASE +
            'background:#fff;color:#e67e22;border-color:#e67e22;';
        btn.onclick   = () => showGiftCardPopup(getSaleId());

        anchor.insertAdjacentElement('afterend', btn);
        LOG('Bottone 🎁 CARTE iniettato');
    }

    function tryInject() {
        if (!shouldShow()) {
            ['exc-usd-btn', 'exc-gc-btn'].forEach(id => document.getElementById(id)?.remove());
            return;
        }
        injectUSDButton();
        injectGiftCardButton();
    }

    // ── Watcher pagina Gift Card — auto-fill Utiliser + click Retour Vente ───
    function findRetourVenteBtn() {
        return Array.from(document.querySelectorAll('a,button')).find(el =>
            /retour.{0,4}vente/i.test(el.textContent || '')
        );
    }

    function isOnGiftCardPage() {
        return !!Array.from(document.querySelectorAll('h1,h2,h3,h4')).find(el =>
            /utiliser.{0,10}carte/i.test(el.textContent || '')
        );
    }

    // Trova il form "Utiliser" — ha UN SOLO input (il codice).
    // Il form "Vendre" ha 3 input (montant, validité, code) — da ignorare.
    function findUtiliserForm() {
        const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,legend,.panel-title'))
            .filter(el => /utiliser/i.test(el.textContent || ''));

        for (const head of heads) {
            // Cerca il container padre che contiene esattamente 1 input visibile + 1 bottone
            let el = head.parentElement;
            for (let i = 0; i < 10; i++) {
                if (!el || el === document.body) break;
                const inputs = Array.from(el.querySelectorAll('input')).filter(
                    inp => !['hidden','submit','button','checkbox','radio','date'].includes(inp.type)
                );
                const btn = el.querySelector('button[type="submit"], input[type="submit"], button:not([type="button"])');
                // Utiliser ha 1 solo input (il codice). Vendre ne ha 3+.
                if (inputs.length === 1 && btn) {
                    return { input: inputs[0], btn, container: el };
                }
                el = el.parentElement;
            }
        }
        return null;
    }

    let _gcPageWatching = false;
    function watchGiftCardPage() {
        if (!isOnGiftCardPage()) return;
        if (_gcPageWatching) return;
        _gcPageWatching = true;

        const code = GM_getValue('exc_pending_code', null);
        LOG('🎁 Pagina gift card rilevata | exc_pending_code:', code);

        // ── Auto-fill form Utiliser se c'è un codice in attesa ───────────────
        if (code) {
            let filled = false;
            function tryFill(retries) {
                if (filled || retries > 40) return;
                const form = findUtiliserForm();
                if (!form) { setTimeout(() => tryFill(retries + 1), 300); return; }

                filled = true;
                LOG('🎁 Fill Utiliser | input:', form.input.name || form.input.placeholder);
                form.container.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setVal(form.input, code);
                setTimeout(() => {
                    setVal(form.input, code); // re-fill sicurezza
                    LOG('🎁 Click Valider Utiliser');
                    form.btn.click();
                    GM_deleteValue('exc_pending_code');
                    GM_deleteValue('exc_iframe_step');
                }, 700);
            }
            setTimeout(() => tryFill(0), 900);
        }

        // ── Watcher successo → click Retour Vente ────────────────────────────
        let redirected = false;
        const gcObs = new MutationObserver(() => {
            if (redirected) return;
            const ok = document.querySelector('.alert-success,.flash-success,[class*="alert-success"]');
            if (ok && /utilisée|appliqué|succès|success/i.test(ok.textContent || '')) {
                redirected = true;
                gcObs.disconnect();
                LOG('✅ Gift card utilisée — click Retour Vente dans 1.2s');
                setTimeout(() => {
                    const retourBtn = findRetourVenteBtn();
                    if (retourBtn) { retourBtn.click(); }
                    else {
                        const n = document.createElement('div');
                        n.style.cssText =
                            'position:fixed;top:10px;right:10px;background:#28a745;color:#fff;' +
                            'padding:14px 20px;border-radius:8px;font-family:system-ui;font-weight:bold;' +
                            'font-size:14px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
                        n.innerHTML = '✅ Carte appliquée !<br><small>Cliquez "Retour Vente"</small>';
                        document.body.appendChild(n);
                        setTimeout(() => n.remove(), 8000);
                    }
                }, 1200);
            }
        });
        gcObs.observe(document.body, { childList: true, subtree: true });
        // Reset flag al cambio pagina
        setTimeout(() => { _gcPageWatching = false; }, 30000);
    }

    // ── Iniezione iniziale + observer DOM (dopo check credenziali) ────────────
    ensureCredentials().then(() => {
        discoverPaymentTypes();
        tryInject();
        watchGiftCardPage();
        [100, 500, 1500].forEach(ms => setTimeout(tryInject, ms));
    });

    const domObs = new MutationObserver(() => {
        if (domObs._t) return;
        domObs._t = setTimeout(() => { domObs._t = null; tryInject(); watchGiftCardPage(); }, 250);
    });
    domObs.observe(document.body, { childList: true, subtree: true });

    setInterval(tryInject, 1500);

    let lastHref = location.href;
    setInterval(() => {
        if (location.href !== lastHref) {
            lastHref = location.href;
            tryInject();
            setTimeout(watchGiftCardPage, 500);
        }
    }, 800);

    LOG('UserScript v5.7 (EXC-Change) attivo — USD sale · avoir · chiusura EUR manuale · CARTE iframe nascosto');
})();
