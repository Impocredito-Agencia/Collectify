// Phase 36 — an on/off switch for a client's email or SMS reminders, used
// by the Correo y SMS recipients list and the client's profile.
interface ChannelSwitchProps {
  isOn: boolean;
  disabled: boolean;
  title: string;
  label: string;
  onChange: (isOn: boolean) => void;
}

export function ChannelSwitch({
  isOn,
  disabled,
  title,
  label,
  onChange,
}: ChannelSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!isOn)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        isOn ? 'bg-accent-secondary' : 'bg-accent-secondary-dim'
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full transition-all ${
          isOn ? 'left-[18px] bg-white' : 'left-0.5 bg-accent-secondary-soft'
        }`}
      />
    </button>
  );
}
