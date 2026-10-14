# Do & Inspiration for SillyTavern

A standalone SillyTavern UI extension for drafting roleplay actions and generating character-response options. It uses SillyTavern's currently selected text-generation connection through `generateQuietPrompt`; it does not need a separate API key or call a provider directly from the browser.

## Actions

- **Do** reads the text in the message box and creates three richer rewrites. It is instructed to preserve the user's intent, point of view, events, and outcome without adding major new facts. Select an option to replace the draft in the composer; it is not sent until you press SillyTavern's Send button.
- **Inspiration** uses recent chat and, optionally, the active character card to create three possible character replies. Choose **Add as character reply** to add the selected option directly to chat, or **Put in message box instead** to edit it before sending.
- The buttons are placed by the SillyTavern composer when available. A copy of the buttons is also in the extension settings panel.
- Settings control recent-message context, whether character-card details are included, and the Do rewrite style.

## Install

1. In SillyTavern, open **Extensions → Install Extension** and paste `https://github.com/mcmaccasman-dotcom/sillytavern-do-inspiration`.
2. Refresh SillyTavern. Open **Extensions → Manage Extensions**, enable **Do & Inspiration**, then open its settings drawer.
3. If installing manually, copy this folder into `data/<user-handle>/extensions/sillytavern-do-inspiration/`.
4. Make sure a text-generation API is connected and selected in SillyTavern.

## Notes

- The active SillyTavern text backend/model generates all three choices. Results depend on its model, prompt context, and settings.
- This extension reads recent chat messages and optional character-card fields in the browser and sends them through the active SillyTavern backend using its normal quiet-prompt mechanism.
- Choosing an Inspiration result to add as a character reply directly appends that text to the current chat. It does not make another model call and does not trigger the normal character response generation.

## API reference

SillyTavern's extension guide documents `generateQuietPrompt` for quiet prompts from UI extensions: https://docs.sillytavern.app/for-contributors/writing-extensions/
