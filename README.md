<div align="center">

<img src="https://raw.githubusercontent.com/BeastBoy2209/google-forms-ai-autofiller/main/Icon.png" alt="Logo" width="120" height="120" />

# Google Forms AI AutoFiller

**A Chrome Extension that automatically fills Google Forms using AI**

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--5.4-412991?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com)
[![Anthropic](https://img.shields.io/badge/Anthropic-Claude-CC785C?style=for-the-badge&logo=anthropic&logoColor=white)](https://anthropic.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](./LICENSE)
[![Ko-Fi](https://img.shields.io/badge/Ko--fi-Donate-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/beastboy2209)

[Key Features](#-key-features) · [Installation](#-installation) · [How to Use](#-how-to-use) · [How It Works](#-how-it-works) · [Limitations](#-limitations) · [License](#-license)

---

</div>

## ✨ Key Features

- 🤖 **Dual AI Provider Support** — works with both OpenAI and Anthropic APIs
- ⚡ **One-Click Autofill** — fills your entire Google Form in seconds
- 🧠 **Context-Aware Answers** — provide personal context to get smarter, personalized responses
- 🎯 **Smart Question Detection** — automatically identifies question types and available options
- 🔒 **Local Storage** — API keys stored locally in `chrome.storage.sync`, never sent to third parties
- 📐 **Constraint Enforcement** — respects selection limits (e.g., "choose up to 3")

## 🤖 Supported AI Models

| Provider | Model | Notes |
|----------|-------|-------|
| **OpenAI** | `gpt-5.4` | ⭐ Recommended |
| OpenAI | `gpt-5.4-mini` | Faster |
| OpenAI | `gpt-5.4-nano` | Budget-friendly |
| **Anthropic** | `claude-sonnet-4-6` | ⭐ Recommended |
| Anthropic | `claude-haiku-latest` | Most affordable |

## 📋 Supported Question Types

| Type | Description |
|------|-------------|
| `text` | Open-ended text responses |
| `single_choice` | Radio button / single selection |
| `multiple_choice` | Checkboxes / multiple selections with limit enforcement |

## 📦 Installation

> **Note:** This extension is currently in developer mode only. Chrome Web Store release is planned.

1. Clone or download this repository:
   ```bash
   git clone https://github.com/BeastBoy2209/google-forms-ai-autofiller.git
   ```

2. Open Chrome and navigate to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the project folder

5. The extension icon will appear in your Chrome toolbar ✅

## 🚀 How to Use

1. **Open** any Google Form (in fill-out mode, not edit mode)
2. **Click** the extension icon in your Chrome toolbar
3. **Select** your AI provider: `OpenAI` or `Anthropic`
4. **Enter** your API key and choose a model
5. *(Optional)* **Add context** about yourself to improve answer quality
6. **Click** `Fill Form` and watch the magic happen ✨

### 💡 Context Example

```
I'm a 3rd year Computer Science student. I enjoy Python and AI/ML.
I prefer backend development and have experience with Docker and FastAPI.
```

## ⚙️ How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        Google Forms Page                        │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 1. Read questions
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Content Script                            │
│   • Detects question types (text / single / multiple_choice)    │
│   • Extracts options and selection constraints                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 2. Send structured form data
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Service Worker                            │
│   • Calls OpenAI or Anthropic API                               │
│   • Receives JSON response with answers                         │
│   • Applies post-processing (enforces selection limits)         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 3. Apply answers
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Content Script                            │
│   • Maps answers back to form fields                            │
│   • Fills text inputs, selects radio buttons, checks boxes      │
└─────────────────────────────────────────────────────────────────┘
```

## 📄 API Payload Format

The following JSON structure is sent to the AI model:

```json
{
  "userContext": "I'm a CS student who loves Python and AI.",
  "questions": [
    {
      "id": "q_1",
      "text": "Tell us about yourself",
      "type": "text",
      "options": [],
      "required": true
    },
    {
      "id": "q_2",
      "text": "Your favorite language",
      "type": "single_choice",
      "options": ["Python", "Java", "C++"],
      "required": false
    },
    {
      "id": "q_3",
      "text": "Technologies you use",
      "type": "multiple_choice",
      "options": ["Docker", "Kubernetes", "React"],
      "required": false
    }
  ]
}
```

## ⚠️ Limitations

- **DOM Fragility** — Google Forms may update their HTML structure; selectors may need updating if the extension breaks
- **Unsupported Question Types** — dates, times, matrix questions, and file uploads are not yet supported
- **API Costs** — using this extension consumes API credits from your OpenAI or Anthropic account

## 🔐 Security

- API keys are stored in `chrome.storage.sync` and never transmitted to any server other than OpenAI/Anthropic
- Do **not** include sensitive personal data in the context field unless necessary
- It is recommended to use API keys with **budget limits** and **restricted permissions**

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 💖 Support

If this project saved you time, consider buying me a coffee:

[![Ko-Fi](https://img.shields.io/badge/Ko--fi-Donate-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/beastboy2209)

## 📝 License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

---

<div align="center">

Made with ❤️ by [BeastBoy2209](https://github.com/BeastBoy2209)

</div>
