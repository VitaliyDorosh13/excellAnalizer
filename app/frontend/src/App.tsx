import { useEffect, useMemo, useState } from "react";

type TimerMode = "focus" | "shortBreak" | "longBreak";
type BackgroundStyle = "aurora" | "sunset" | "forest" | "mono";

interface TimerSettings {
  focus: number;
  shortBreak: number;
  longBreak: number;
  longBreakEvery: number;
}

interface ModeMeta {
  label: string;
  eyebrow: string;
  helper: string;
}

interface BackgroundOption {
  id: BackgroundStyle;
  name: string;
  description: string;
}

const modeMeta: Record<TimerMode, ModeMeta> = {
  focus: {
    label: "Фокус",
    eyebrow: "Deep work",
    helper: "Один спокійний відрізок роботи без зайвого шуму."
  },
  shortBreak: {
    label: "Коротка перерва",
    eyebrow: "Recharge",
    helper: "Встань, розімни плечі, дай очам кілька хвилин свободи."
  },
  longBreak: {
    label: "Довга перерва",
    eyebrow: "Reset",
    helper: "Більша пауза після серії фокус-сесій."
  }
};

const backgroundOptions: BackgroundOption[] = [
  {
    id: "aurora",
    name: "Aurora",
    description: "холодне сяйво"
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "теплий вечір"
  },
  {
    id: "forest",
    name: "Forest",
    description: "глибокий зелений"
  },
  {
    id: "mono",
    name: "Mono",
    description: "мінімальний темний"
  }
];

const defaultSettings: TimerSettings = {
  focus: 25,
  shortBreak: 5,
  longBreak: 15,
  longBreakEvery: 4
};

function secondsFromMinutes(minutes: number) {
  return Math.max(1, Math.round(minutes)) * 60;
}

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function clampDuration(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(120, Math.max(1, Math.round(value)));
}

export default function App() {
  const [settings, setSettings] = useState<TimerSettings>(defaultSettings);
  const [activeMode, setActiveMode] = useState<TimerMode>("focus");
  const [secondsRemaining, setSecondsRemaining] = useState(() => secondsFromMinutes(defaultSettings.focus));
  const [isRunning, setIsRunning] = useState(false);
  const [completedFocusSessions, setCompletedFocusSessions] = useState(0);
  const [backgroundStyle, setBackgroundStyle] = useState<BackgroundStyle>("aurora");

  const totalSeconds = secondsFromMinutes(settings[activeMode]);
  const elapsedSeconds = totalSeconds - secondsRemaining;
  const progress = totalSeconds > 0 ? Math.min(1, Math.max(0, elapsedSeconds / totalSeconds)) : 0;
  const currentMode = modeMeta[activeMode];
  const nextMode = useMemo(
    () => getNextMode(activeMode, completedFocusSessions, settings.longBreakEvery),
    [activeMode, completedFocusSessions, settings.longBreakEvery]
  );

  useEffect(() => {
    document.title = `${formatTime(secondsRemaining)} - ${currentMode.label}`;
  }, [currentMode.label, secondsRemaining]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSecondsRemaining((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isRunning]);

  useEffect(() => {
    if (isRunning && secondsRemaining === 0) {
      completeCurrentRound();
    }
  }, [isRunning, secondsRemaining]);

  function completeCurrentRound() {
    setIsRunning(false);
    setCompletedFocusSessions((current) => {
      const nextCompleted = activeMode === "focus" ? current + 1 : current;
      const nextTimerMode = getNextMode(activeMode, nextCompleted, settings.longBreakEvery);
      setActiveMode(nextTimerMode);
      setSecondsRemaining(secondsFromMinutes(settings[nextTimerMode]));
      return nextCompleted;
    });
  }

  function selectMode(mode: TimerMode) {
    setActiveMode(mode);
    setIsRunning(false);
    setSecondsRemaining(secondsFromMinutes(settings[mode]));
  }

  function updateDuration(field: keyof TimerSettings, value: number) {
    setSettings((current) => {
      const nextValue =
        field === "longBreakEvery"
          ? Math.min(12, Math.max(2, Math.round(value) || current.longBreakEvery))
          : clampDuration(value, current[field]);
      const nextSettings = { ...current, [field]: nextValue };

      if (!isRunning && field === activeMode) {
        setSecondsRemaining(secondsFromMinutes(nextSettings[activeMode]));
      }

      return nextSettings;
    });
  }

  function resetTimer() {
    setIsRunning(false);
    setSecondsRemaining(secondsFromMinutes(settings[activeMode]));
  }

  function skipRound() {
    completeCurrentRound();
  }

  const focusUntilLongBreak = settings.longBreakEvery - (completedFocusSessions % settings.longBreakEvery);

  return (
    <main className={`app-shell theme-${backgroundStyle}`}>
      <section className="timer-hero">
        <div>
          <p className="eyebrow">Pomodoro Timer</p>
          <h1>Фокусуйся красиво. Відпочивай вчасно.</h1>
          <p className="hero-copy">
            Мінімалістичний таймер із гнучкими сесіями, сучасним інтерфейсом і фонами під настрій.
          </p>
        </div>
        <div className="hero-stats" aria-label="Статистика сесій">
          <span>Завершено фокусів</span>
          <strong>{completedFocusSessions}</strong>
        </div>
      </section>

      <section className="timer-layout">
        <article className="timer-card" aria-label="Поточний таймер">
          <div className="mode-switcher" role="tablist" aria-label="Режим таймера">
            <ModeButton active={activeMode === "focus"} label="Фокус" onClick={() => selectMode("focus")} />
            <ModeButton active={activeMode === "shortBreak"} label="Пауза" onClick={() => selectMode("shortBreak")} />
            <ModeButton active={activeMode === "longBreak"} label="Довга" onClick={() => selectMode("longBreak")} />
          </div>

          <div
            className="timer-ring"
            style={{ "--progress": `${progress * 360}deg` } as React.CSSProperties}
            aria-label={`Залишилось ${formatTime(secondsRemaining)}`}
          >
            <div className="timer-ring-inner">
              <span>{currentMode.eyebrow}</span>
              <strong>{formatTime(secondsRemaining)}</strong>
              <p>{currentMode.label}</p>
            </div>
          </div>

          <p className="mode-helper">{currentMode.helper}</p>

          <div className="timer-actions">
            <button className="primary-button" onClick={() => setIsRunning((current) => !current)} type="button">
              {isRunning ? "Пауза" : "Старт"}
            </button>
            <button className="secondary-button" onClick={resetTimer} type="button">
              Скинути
            </button>
            <button className="secondary-button" onClick={skipRound} type="button">
              Пропустити
            </button>
          </div>

          <div className="next-session">
            <span>Далі</span>
            <strong>{modeMeta[nextMode].label}</strong>
          </div>
        </article>

        <aside className="control-panel" aria-label="Налаштування таймера">
          <section className="panel-section">
            <div className="section-heading">
              <p className="eyebrow">Sessions</p>
              <h2>Налаштування часу</h2>
            </div>
            <div className="settings-grid">
              <DurationField
                label="Фокус"
                value={settings.focus}
                onChange={(value) => updateDuration("focus", value)}
              />
              <DurationField
                label="Коротка перерва"
                value={settings.shortBreak}
                onChange={(value) => updateDuration("shortBreak", value)}
              />
              <DurationField
                label="Довга перерва"
                value={settings.longBreak}
                onChange={(value) => updateDuration("longBreak", value)}
              />
              <DurationField
                label="Довга після"
                suffix="фокусів"
                value={settings.longBreakEvery}
                onChange={(value) => updateDuration("longBreakEvery", value)}
              />
            </div>
          </section>

          <section className="panel-section">
            <div className="section-heading">
              <p className="eyebrow">Background</p>
              <h2>Стиль фону</h2>
            </div>
            <div className="background-grid">
              {backgroundOptions.map((option) => (
                <button
                  className={`background-option background-${option.id}${
                    backgroundStyle === option.id ? " background-option-active" : ""
                  }`}
                  key={option.id}
                  onClick={() => setBackgroundStyle(option.id)}
                  type="button"
                >
                  <span aria-hidden="true" />
                  <strong>{option.name}</strong>
                  <small>{option.description}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="focus-plan">
            <span>До довгої перерви</span>
            <strong>{focusUntilLongBreak === settings.longBreakEvery ? settings.longBreakEvery : focusUntilLongBreak}</strong>
            <p>фокус-сесій залишилось у поточному циклі</p>
          </section>
        </aside>
      </section>
    </main>
  );
}

function getNextMode(
  activeMode: TimerMode,
  completedFocusSessions: number,
  longBreakEvery: number
): TimerMode {
  if (activeMode !== "focus") {
    return "focus";
  }

  return completedFocusSessions > 0 && completedFocusSessions % longBreakEvery === 0
    ? "longBreak"
    : "shortBreak";
}

function ModeButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`mode-button${props.active ? " mode-button-active" : ""}`}
      onClick={props.onClick}
      role="tab"
      aria-selected={props.active}
      type="button"
    >
      {props.label}
    </button>
  );
}

function DurationField(props: {
  label: string;
  suffix?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="duration-field">
      <span>{props.label}</span>
      <div>
        <input
          min={1}
          max={props.suffix ? 12 : 120}
          type="number"
          value={props.value}
          onChange={(event) => props.onChange(Number(event.target.value))}
        />
        <small>{props.suffix ?? "хв"}</small>
      </div>
    </label>
  );
}
