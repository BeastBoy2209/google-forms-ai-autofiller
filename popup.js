const ALLOWED_MODELS = {
  openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]
};

const DEFAULT_SETTINGS = {
  provider: "openai",
  openaiApiKey: "",
  openaiModel: "gpt-5.4",
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-4-6",
  userContext: "",
  extraInstructions: "",
  temperature: 0.2
};

const ui = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindUiElements();
  bindEvents();

  const savedSettings = await getFromStorage(Object.keys(DEFAULT_SETTINGS));
  const settings = { ...DEFAULT_SETTINGS, ...savedSettings };

  applySettings(settings);
  updateProviderVisibility(settings.provider);
  setStatus("Настройки загружены.");
}

function bindUiElements() {
  ui.provider = document.getElementById("provider");
  ui.openaiApiKey = document.getElementById("openaiApiKey");
  ui.openaiModel = document.getElementById("openaiModel");
  ui.anthropicApiKey = document.getElementById("anthropicApiKey");
  ui.anthropicModel = document.getElementById("anthropicModel");
  ui.userContext = document.getElementById("userContext");
  ui.extraInstructions = document.getElementById("extraInstructions");
  ui.temperature = document.getElementById("temperature");
  ui.openaiBlock = document.getElementById("openaiBlock");
  ui.anthropicBlock = document.getElementById("anthropicBlock");
  ui.saveButton = document.getElementById("saveButton");
  ui.fillButton = document.getElementById("fillButton");
  ui.status = document.getElementById("status");
}

function bindEvents() {
  ui.provider.addEventListener("change", () => {
    updateProviderVisibility(ui.provider.value);
  });

  ui.saveButton.addEventListener("click", async () => {
    try {
      const settings = readSettingsFromForm();
      validateSettings(settings, false);
      await setToStorage(settings);
      setStatus("Настройки сохранены.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  ui.fillButton.addEventListener("click", async () => {
    try {
      setStatus("Собираю форму и отправляю запрос в ИИ...");

      const settings = readSettingsFromForm();
      validateSettings(settings, true);
      await setToStorage(settings);

      const activeTab = await getActiveTab();
      if (!activeTab || !activeTab.id) {
        throw new Error("Не удалось определить активную вкладку.");
      }

      if (!isGoogleFormUrl(activeTab.url)) {
        throw new Error("Откройте страницу Google Forms перед запуском.");
      }

      const response = await sendMessageToTab(activeTab.id, {
        type: "START_AUTOFILL",
        settings: buildRuntimeSettings(settings)
      });

      if (!response || !response.ok) {
        throw new Error(response?.error || "Автозаполнение завершилось с ошибкой.");
      }

      setStatus(
        `Готово. Найдено: ${response.questionsFound}, заполнено: ${response.answersApplied}, без ответа: ${response.unanswered}.`,
        "success"
      );
    } catch (error) {
      setStatus(formatUiError(error), "error");
    }
  });
}

function readSettingsFromForm() {
  return {
    provider: ui.provider.value,
    openaiApiKey: ui.openaiApiKey.value.trim(),
    openaiModel: normalizeModelValue("openai", ui.openaiModel.value),
    anthropicApiKey: ui.anthropicApiKey.value.trim(),
    anthropicModel: normalizeModelValue("anthropic", ui.anthropicModel.value),
    userContext: ui.userContext.value.trim(),
    extraInstructions: ui.extraInstructions.value.trim(),
    temperature: clampTemperature(ui.temperature.value)
  };
}

function validateSettings(settings, strict) {
  if (!settings.provider) {
    throw new Error("Выберите провайдера API.");
  }

  if (!isAllowedModel("openai", settings.openaiModel)) {
    throw new Error("Выбрана недоступная OpenAI модель.");
  }

  if (!isAllowedModel("anthropic", settings.anthropicModel)) {
    throw new Error("Выбрана недоступная Anthropic модель.");
  }

  if (strict && settings.provider === "openai" && !settings.openaiApiKey) {
    throw new Error("Для OpenAI укажите API key.");
  }

  if (strict && settings.provider === "anthropic" && !settings.anthropicApiKey) {
    throw new Error("Для Anthropic укажите API key.");
  }
}

function applySettings(settings) {
  ui.provider.value = settings.provider;
  ui.openaiApiKey.value = settings.openaiApiKey;
  setSelectValue(ui.openaiModel, normalizeModelValue("openai", settings.openaiModel));
  ui.anthropicApiKey.value = settings.anthropicApiKey;
  setSelectValue(ui.anthropicModel, normalizeModelValue("anthropic", settings.anthropicModel));
  ui.userContext.value = settings.userContext;
  ui.extraInstructions.value = settings.extraInstructions;
  ui.temperature.value = String(settings.temperature);
}

function updateProviderVisibility(provider) {
  const openaiVisible = provider === "openai";
  ui.openaiBlock.style.display = openaiVisible ? "block" : "none";
  ui.anthropicBlock.style.display = openaiVisible ? "none" : "block";
}

function setStatus(message, state = "") {
  ui.status.textContent = message;
  ui.status.classList.remove("error", "success");

  if (state) {
    ui.status.classList.add(state);
  }
}

function buildRuntimeSettings(settings) {
  return {
    provider: settings.provider,
    openaiModel: settings.openaiModel,
    anthropicModel: settings.anthropicModel,
    userContext: settings.userContext,
    extraInstructions: settings.extraInstructions,
    temperature: settings.temperature
  };
}

function setSelectValue(selectElement, value) {
  const exists = Array.from(selectElement.options).some((option) => option.value === value);
  selectElement.value = exists ? value : selectElement.options[0]?.value || "";
}

function isAllowedModel(provider, model) {
  const options = ALLOWED_MODELS[provider] || [];
  return options.includes(model);
}

function normalizeModelValue(provider, model) {
  const options = ALLOWED_MODELS[provider] || [];
  if (options.includes(model)) {
    return model;
  }

  return getDefaultModelForProvider(provider);
}

function getDefaultModelForProvider(provider) {
  if (provider === "anthropic") {
    return DEFAULT_SETTINGS.anthropicModel;
  }

  return DEFAULT_SETTINGS.openaiModel;
}

function clampTemperature(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return DEFAULT_SETTINGS.temperature;
  }

  return Math.min(1, Math.max(0, parsed));
}

function formatUiError(error) {
  const message = error?.message || "Произошла неизвестная ошибка.";

  if (message.includes("Could not establish connection")) {
    return "Контент-скрипт не доступен. Обновите страницу Google Forms и попробуйте снова.";
  }

  return message;
}

function isGoogleFormUrl(url) {
  if (!url) {
    return false;
  }

  return /^https:\/\/docs\.google\.com\/forms\//i.test(url);
}

function getFromStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (data) => {
      resolve(data || {});
    });
  });
}

function setToStorage(payload) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(payload, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(tabs?.[0]);
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response);
    });
  });
}
