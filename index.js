(() => {
    'use strict';

    const EXTENSION_ID = 'do_inspiration_sillytavern';
    const DEFAULTS = {
        contextMessages: 10,
        includeCharacterCard: true,
        doStyle: 'balanced',
    };
    let requestBusy = false;
    let mounted = false;

    function getContext() {
        return window.SillyTavern?.getContext?.();
    }

    function getSettings() {
        const ctx = getContext();
        if (!ctx) return DEFAULTS;
        ctx.extensionSettings ??= {};
        ctx.extensionSettings[EXTENSION_ID] ??= structuredClone(DEFAULTS);
        const value = ctx.extensionSettings[EXTENSION_ID];
        for (const [key, initial] of Object.entries(DEFAULTS)) {
            if (!(key in value)) value[key] = initial;
        }
        return value;
    }

    function persist() {
        getContext()?.saveSettingsDebounced?.();
    }

    function composer() {
        return document.querySelector('#send_textarea');
    }

    function setComposerText(text) {
        const textarea = composer();
        if (!textarea) {
            toast('Could not find the SillyTavern message box.', true);
            return;
        }
        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.focus();
        closeChooser();
    }

    function toast(message, isError = false) {
        const toastr = window.toastr;
        if (toastr) {
            (isError ? toastr.error : toastr.info)(message, 'Do & Inspiration', { timeOut: 5000 });
        } else {
            console[isError ? 'error' : 'info'](`[Do & Inspiration] ${message}`);
        }
    }

    function activeCharacterText(ctx) {
        if (!getSettings().includeCharacterCard) return '';
        const chars = [];
        if (Number.isInteger(ctx.characterId) && ctx.characterId >= 0 && ctx.characters?.[ctx.characterId]) {
            chars.push(ctx.characters[ctx.characterId]);
        }
        const group = Number.isInteger(ctx.groupId) && ctx.groupId >= 0 ? ctx.groups?.[ctx.groupId] : null;
        if (Array.isArray(group?.members)) {
            for (const member of group.members) {
                const found = ctx.characters?.find(char => char.avatar === member || char.name === member);
                if (found && !chars.includes(found)) chars.push(found);
            }
        }
        return chars.map(char => {
            const card = char.data || char;
            const fields = [
                ['Name', char.name || card.name],
                ['Description', card.description],
                ['Personality', card.personality],
                ['Scenario', card.scenario],
                ['Example dialogue', card.mes_example],
            ].filter(([, text]) => typeof text === 'string' && text.trim());
            return fields.map(([label, text]) => `${label}: ${text.trim().slice(0, 3000)}`).join('\n');
        }).filter(Boolean).join('\n\n').slice(0, 9000);
    }

    function recentChatText(ctx) {
        const rows = (ctx.chat || []).filter(message => message && !message.is_system && typeof message.mes === 'string' && message.mes.trim());
        return rows.slice(-getSettings().contextMessages).map(message => {
            const author = message.name || (message.is_user ? 'User' : 'Character');
            return `${author}: ${message.mes.trim().slice(0, 2200)}`;
        }).join('\n\n').slice(-16000);
    }

    function buildPrompt(kind, ctx, userDraft) {
        const character = activeCharacterText(ctx);
        const history = recentChatText(ctx);
        const common = `\n\nACTIVE CHARACTER CARD (if present):\n${character || '(No character card supplied)'}\n\nRECENT CHAT:\n${history || '(No recent chat)'}\n\nReturn only valid JSON with exactly this shape: {"options":[{"title":"short label","text":"the complete option"},{"title":"short label","text":"the complete option"},{"title":"short label","text":"the complete option"}]}. No markdown fences or extra text.`;
        if (kind === 'do') {
            const style = getSettings().doStyle;
            return `You are a roleplay writing editor. Rewrite the user's proposed action into exactly THREE distinct, vivid, natural alternatives. Preserve the user's intent, events, outcome, character agency, and point of view; do not add major facts, decisions, dialogue, or consequences that the user did not specify. Make each alternative more detailed and immersive, but keep it plausible and ready to paste as the user's next chat message. The requested style emphasis is: ${style}. The three alternatives should vary in rhythm/detail, not contradict each other.\n\nUSER'S ACTION TO REWRITE:\n${userDraft}${common}`;
        }
        return `You are the currently active SillyTavern character writing the next possible reply. Generate exactly THREE distinct response options that could naturally follow this conversation. Stay faithful to the character card, voice, knowledge, and current situation. Do not write the user's actions or dialogue. Do not claim that any option has already happened; each is an alternate possible next reply. Vary their tone or approach while preserving continuity. Keep each response useful and ready to send as the character, with no meta commentary.\n\n${common}`;
    }

    async function callActiveModel(prompt) {
        const script = await import('/script.js');
        if (typeof script.generateQuietPrompt !== 'function') {
            throw new Error('This SillyTavern version does not expose generateQuietPrompt. Update SillyTavern and try again.');
        }
        const result = await script.generateQuietPrompt({ quietPrompt: prompt });
        if (typeof result === 'string') return result;
        if (typeof result?.text === 'string') return result.text;
        if (typeof result?.content === 'string') return result.content;
        throw new Error('The active model returned an empty response.');
    }

    function parseOptions(response) {
        const text = String(response || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        try {
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}');
            const parsed = JSON.parse(start >= 0 ? text.slice(start, end + 1) : text);
            const options = parsed.options || parsed.choices || parsed;
            if (Array.isArray(options)) {
                const valid = options.map((item, index) => typeof item === 'string'
                    ? { title: `Option ${index + 1}`, text: item.trim() }
                    : { title: String(item.title || `Option ${index + 1}`), text: String(item.text || item.content || '').trim() })
                    .filter(item => item.text);
                if (valid.length >= 3) return valid.slice(0, 3);
            }
        } catch { /* fall through to labelled-text parsing */ }

        const chunks = [...text.matchAll(/(?:^|\n)\s*(?:option\s*)?([1-3])[).:\-]\s*([\s\S]*?)(?=(?:\n\s*(?:option\s*)?[1-3][).:\-])|$)/gi)];
        const parsed = chunks.map((match, index) => ({ title: `Option ${index + 1}`, text: match[2].trim() })).filter(item => item.text);
        if (parsed.length >= 3) return parsed.slice(0, 3);
        throw new Error('Could not identify three options in the model response. Try again.');
    }

    function closeChooser() {
        document.querySelector('.sdi-backdrop')?.remove();
    }

    async function addAsCharacterReply(text) {
        const ctx = getContext();
        if (!ctx?.chat) return toast('Open a chat first.', true);
        const active = Number.isInteger(ctx.characterId) && ctx.characterId >= 0 ? ctx.characters?.[ctx.characterId] : null;
        const lastCharacterMessage = [...ctx.chat].reverse().find(message => !message.is_user && !message.is_system);
        const name = active?.name || lastCharacterMessage?.name || ctx.groups?.[ctx.groupId]?.name || 'Character';
        const message = {
            name,
            is_user: false,
            is_system: false,
            mes: text,
            send_date: new Date().toISOString(),
            extra: { do_inspiration_option: true },
        };
        ctx.chat.push(message);
        try {
            const script = await import('/script.js');
            if (typeof script.addOneMessage === 'function') script.addOneMessage(message);
            else if (typeof script.printMessages === 'function') await script.printMessages();
            else throw new Error('SillyTavern does not expose a chat renderer.');
            if (typeof script.saveChatDebounced === 'function') script.saveChatDebounced();
            closeChooser();
            toast('Added the selected option as a character reply.');
        } catch (error) {
            ctx.chat.pop();
            console.error('[Do & Inspiration] Could not insert character reply:', error);
            toast(`Could not add the reply to chat: ${error.message}`, true);
        }
    }

    function showChooser(kind, options) {
        closeChooser();
        const overlay = document.createElement('div');
        overlay.className = 'sdi-backdrop';
        overlay.setAttribute('role', 'presentation');
        const dialog = document.createElement('section');
        dialog.className = 'sdi-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'sdi-title');
        const header = document.createElement('header');
        const title = document.createElement('h2');
        title.id = 'sdi-title';
        title.textContent = kind === 'do' ? 'Choose your rewritten action' : 'Choose a character response';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'menu_button sdi-close';
        close.textContent = 'Close';
        close.addEventListener('click', closeChooser);
        header.append(title, close);
        dialog.append(header);
        options.forEach((option, index) => {
            const card = document.createElement('article');
            card.className = 'sdi-option';
            const heading = document.createElement('h3');
            heading.textContent = option.title || `Option ${index + 1}`;
            const body = document.createElement('p');
            body.textContent = option.text;
            const use = document.createElement('button');
            use.type = 'button';
            use.className = 'menu_button sdi-use';
            use.textContent = kind === 'do' ? 'Use this action' : 'Add as character reply';
            use.addEventListener('click', () => kind === 'do' ? setComposerText(option.text) : addAsCharacterReply(option.text));
            card.append(heading, body, use);
            if (kind === 'inspiration') {
                const draft = document.createElement('button');
                draft.type = 'button';
                draft.className = 'menu_button sdi-draft';
                draft.textContent = 'Put in message box instead';
                draft.addEventListener('click', () => setComposerText(option.text));
                card.append(draft);
            }
            dialog.append(card);
        });
        overlay.addEventListener('click', event => { if (event.target === overlay) closeChooser(); });
        overlay.append(dialog);
        document.body.append(overlay);
        dialog.querySelector('.sdi-close')?.focus();
    }

    async function run(kind) {
        if (requestBusy) return;
        const ctx = getContext();
        if (!ctx?.chat) return toast('Open a chat first.', true);
        const draft = kind === 'do' ? (composer()?.value || '').trim() : '';
        if (kind === 'do' && !draft) return toast('Type the action you want rewritten in the message box first.', true);
        requestBusy = true;
        updateButtonState(true);
        try {
            toast(kind === 'do' ? 'Creating three action rewrites…' : 'Creating three inspiration replies…');
            const prompt = buildPrompt(kind, ctx, draft);
            const raw = await callActiveModel(prompt);
            const options = parseOptions(raw);
            showChooser(kind, options);
        } catch (error) {
            console.error('[Do & Inspiration]', error);
            toast(error.message || 'Generation failed.', true);
        } finally {
            requestBusy = false;
            updateButtonState(false);
        }
    }

    function updateButtonState(disabled) {
        document.querySelectorAll('.sdi-action').forEach(button => {
            button.disabled = disabled;
            button.classList.toggle('sdi-busy', disabled);
        });
    }

    function createActionButton(kind) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `menu_button sdi-action sdi-${kind}`;
        button.textContent = kind === 'do' ? 'Do' : 'Inspiration';
        button.title = kind === 'do'
            ? 'Rewrite your drafted action into three detailed options'
            : 'Generate three possible character responses';
        button.addEventListener('click', () => run(kind));
        return button;
    }

    function mountButtons() {
        if (mounted) return;
        const send = document.querySelector('#send_but');
        const textarea = composer();
        const anchor = send || textarea;
        if (!anchor?.parentElement) return;
        const container = document.createElement('div');
        container.className = 'sdi-actions';
        container.append(createActionButton('do'), createActionButton('inspiration'));
        anchor.parentElement.insertBefore(container, send || textarea.nextSibling);
        mounted = true;
    }

    function makeSettingsPanel() {
        if (document.getElementById('sdi-settings')) return;
        const host = document.getElementById('extensions_settings');
        if (!host) return;
        const prefs = getSettings();
        const panel = document.createElement('div');
        panel.id = 'sdi-settings';
        panel.className = 'extension_settings';
        panel.innerHTML = `<div class="inline-drawer"><div class="inline-drawer-header"><b>Do &amp; Inspiration</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div></div><div class="inline-drawer-content"><p>Uses the currently selected SillyTavern model. Choose an option to place it in the message box; it will not send until you press Send.</p><label class="sdi-setting">Context messages <input class="text_pole sdi-context" type="number" min="2" max="30" value="${prefs.contextMessages}"></label><label class="sdi-setting">Do-action rewrite style <select class="text_pole sdi-style"><option value="balanced">Balanced and natural</option><option value="grounded">Grounded and concise</option><option value="sensory">More sensory detail</option><option value="cinematic">Cinematic pacing</option></select></label><label class="sdi-check"><input type="checkbox" class="sdi-character-card" ${prefs.includeCharacterCard ? 'checked' : ''}> Include active character card details</label><div class="sdi-panel-actions"></div></div></div>`;
        host.append(panel);
        panel.querySelector('.sdi-style').value = prefs.doStyle;
        panel.querySelector('.sdi-context').addEventListener('change', event => {
            prefs.contextMessages = Math.min(30, Math.max(2, Number(event.target.value) || 10));
            persist();
        });
        panel.querySelector('.sdi-style').addEventListener('change', event => { prefs.doStyle = event.target.value; persist(); });
        panel.querySelector('.sdi-character-card').addEventListener('change', event => { prefs.includeCharacterCard = event.target.checked; persist(); });
        panel.querySelector('.sdi-panel-actions').append(createActionButton('do'), createActionButton('inspiration'));
    }

    function initialize() {
        if (!getContext()) return;
        getSettings();
        makeSettingsPanel();
        mountButtons();
    }

    document.addEventListener('DOMContentLoaded', initialize, { once: true });
    const ctx = getContext();
    if (ctx?.eventSource && ctx?.event_types?.APP_READY) ctx.eventSource.on(ctx.event_types.APP_READY, initialize);
    let attempts = 0;
    const retry = setInterval(() => {
        initialize();
        attempts += 1;
        if (mounted && document.getElementById('sdi-settings') || attempts > 60) clearInterval(retry);
    }, 1000);
})();
