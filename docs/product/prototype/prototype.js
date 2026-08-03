(() => {
  "use strict";

  const root = document.getElementById("runefolio-prototype");
  const screens = [...root.querySelectorAll("[data-screen]")];
  const panels = [...root.querySelectorAll("[data-step]")];
  const stepNames = [
    "Start / ruleset",
    "Class",
    "Origin",
    "Abilities",
    "Class choices",
    "Spells & resources",
    "Equipment",
    "Identity",
    "Review",
  ];
  const state = {
    screen: "library",
    previousScreen: "library",
    step: 0,
    mode: "guided",
    classChoice: "",
    originChoice: "",
  };

  const title = document.getElementById("screen-title");
  const status = document.getElementById("screen-status");
  const back = document.getElementById("back-button");
  const menu = document.getElementById("menu-button");
  const popover = document.getElementById("character-menu");
  const stepCounter = document.getElementById("step-counter");
  const builderTitle = document.getElementById("builder-title");
  const progress = document.getElementById("build-progress");
  const stepList = document.getElementById("step-list");
  const previous = document.getElementById("previous-step");
  const next = document.getElementById("next-step");
  const issueCount = document.getElementById("issue-count");
  const main = document.getElementById("main-content");

  function issueTotal() {
    return Number(!state.classChoice) + Number(!state.originChoice);
  }

  function updateReview() {
    const issues = issueTotal();
    document.getElementById("review-class").textContent = state.classChoice === "vanguard"
      ? "Vanguard · Level 1"
      : state.classChoice === "manual"
        ? "Manual character · Level 1"
        : "Class not chosen · Level 1";
    document.getElementById("review-origin").textContent = state.originChoice
      ? "Riverborn · Caravan Warden"
      : "Not chosen";
    document.getElementById("review-state").textContent = issues ? "Incomplete" : "Ready";
    const warning = document.getElementById("review-warning");
    warning.querySelector("strong").textContent = issues ? `${issues} ${issues === 1 ? "issue" : "issues"} remain` : "Ready for the automatic Play sheet";
    warning.querySelector("span").textContent = issues
      ? "Missing choices remain saved. Flexible mode may keep this draft incomplete."
      : "All minimum automatic-sheet inputs are represented in this prototype.";
  }

  function renderStepList() {
    stepList.replaceChildren();
    stepNames.forEach((name, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const marker = document.createElement("span");
      button.type = "button";
      button.dataset.stepTarget = String(index);
      button.textContent = `${index + 1}. ${name}`;
      if (index === state.step) button.setAttribute("aria-current", "step");
      marker.textContent = index === 5 ? "Not needed" : index < state.step ? "Visited" : "";
      button.append(marker);
      item.append(button);
      stepList.append(item);
    });
  }

  function showStep(index, focus = true) {
    state.step = Math.max(0, Math.min(stepNames.length - 1, index));
    panels.forEach((panel) => {
      panel.hidden = Number(panel.dataset.step) !== state.step;
    });
    stepCounter.textContent = `Step ${state.step + 1} of ${stepNames.length}`;
    builderTitle.textContent = stepNames[state.step];
    progress.value = state.step + 1;
    progress.textContent = `${state.step + 1} of ${stepNames.length}`;
    previous.disabled = state.step === 0;
    next.textContent = state.step === stepNames.length - 1
      ? issueTotal() === 0 ? "Finish and open sheet" : state.mode === "flexible" ? "Save incomplete draft" : "Resolve issues"
      : "Continue";
    issueCount.textContent = `${issueTotal()} blocking ${issueTotal() === 1 ? "issue" : "issues"}`;
    updateReview();
    renderStepList();
    if (focus) builderTitle.focus?.();
  }

  function showScreen(name, focus = true) {
    if (name !== state.screen) state.previousScreen = state.screen;
    state.screen = name;
    screens.forEach((screen) => {
      screen.hidden = screen.dataset.screen !== name;
    });
    const labels = {
      library: ["Characters", "On this device"],
      builder: ["New character", "Draft saved on this device"],
      play: ["Active sheet", "Ready offline"],
      override: ["Value detail", "Automatic baseline preserved"],
      transfer: ["File transfer", "Standard safe scope"],
    };
    title.textContent = labels[name][0];
    status.textContent = labels[name][1];
    back.hidden = name === "library";
    menu.hidden = !["play", "override", "transfer"].includes(name);
    popover.hidden = true;
    menu.setAttribute("aria-expanded", "false");
    if (name === "builder") showStep(state.step, false);
    if (focus) {
      main.focus();
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  document.getElementById("new-character").addEventListener("click", () => {
    state.step = 0;
    state.mode = "guided";
    state.classChoice = "";
    state.originChoice = "";
    document.querySelector('input[name="mode"][value="guided"]').checked = true;
    document.querySelectorAll('input[name="class-choice"], input[name="origin-choice"]').forEach((input) => {
      input.checked = false;
    });
    document.getElementById("mode-note").textContent = "Recommendations and explanations are shown. Existing choices are preserved when mode changes.";
    showScreen("builder");
  });

  root.addEventListener("click", (event) => {
    const route = event.target.closest("[data-route]");
    if (route) {
      event.preventDefault();
      showScreen(route.dataset.route);
      return;
    }
    const stepTarget = event.target.closest("[data-step-target]");
    if (stepTarget) showStep(Number(stepTarget.dataset.stepTarget));
  });

  document.querySelectorAll(".wide-rail [data-route]").forEach((control) => {
    control.addEventListener("click", (event) => {
      event.preventDefault();
      showScreen(control.dataset.route);
    });
  });

  document.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener("change", (event) => {
      state.mode = event.target.value;
      document.getElementById("mode-note").textContent = state.mode === "guided"
        ? "Guidance enabled. Your class and origin choices are still preserved."
        : "Flexible mode enabled. Existing choices remain unchanged and incomplete state may be saved.";
      showStep(state.step, false);
    });
  });

  document.querySelectorAll('input[name="class-choice"]').forEach((input) => {
    input.addEventListener("change", (event) => {
      state.classChoice = event.target.value;
      showStep(state.step, false);
    });
  });

  document.querySelectorAll('input[name="origin-choice"]').forEach((input) => {
    input.addEventListener("change", (event) => {
      state.originChoice = event.target.value;
      showStep(state.step, false);
    });
  });

  document.getElementById("character-name").addEventListener("input", (event) => {
    const safeName = event.target.value.trim() || "Unnamed character";
    document.getElementById("review-name").textContent = safeName;
    document.getElementById("play-title").textContent = safeName;
  });

  previous.addEventListener("click", () => showStep(state.step - 1));
  next.addEventListener("click", () => {
    if (state.step < stepNames.length - 1) {
      showStep(state.step + 1);
      return;
    }
    if (issueTotal() === 0) showScreen("play");
    else if (state.mode === "flexible") showScreen("library");
    else showStep(state.classChoice ? 2 : 1);
  });

  back.addEventListener("click", () => {
    if (state.screen === "builder") showScreen("library");
    else if (["override", "transfer"].includes(state.screen)) showScreen("play");
    else showScreen("library");
  });

  menu.addEventListener("click", () => {
    const expanded = menu.getAttribute("aria-expanded") === "true";
    menu.setAttribute("aria-expanded", String(!expanded));
    popover.hidden = expanded;
    if (!expanded) popover.querySelector("button").focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) {
      popover.hidden = true;
      menu.setAttribute("aria-expanded", "false");
      menu.focus();
    }
  });

  document.getElementById("copy-expression").addEventListener("click", async (event) => {
    const expression = event.currentTarget.dataset.expression;
    try {
      await navigator.clipboard.writeText(expression);
      document.getElementById("copy-status").textContent = `Copied: ${expression}`;
    } catch {
      document.getElementById("copy-status").textContent = `Expression: ${expression}`;
    }
  });

  renderStepList();
  showScreen("library", false);
})();
