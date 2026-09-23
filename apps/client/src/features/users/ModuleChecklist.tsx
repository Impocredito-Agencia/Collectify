import { MODULE_LABELS } from '@/features/auth/authApi';

import type { AppModule } from '@/features/auth/authApi';

const ALL_MODULES = Object.keys(MODULE_LABELS) as AppModule[];

interface ModuleChecklistProps {
  selected: AppModule[];
  onChange: (modules: AppModule[]) => void;
}

// Shared between UserForm.tsx (setting a new collector's initial modules)
// and UserPermissionsDialog.tsx (editing an existing one) — same checklist,
// same 8 modules, same order as Sidebar.tsx's NAV_ITEMS. See
// docs/phasesClient/PHASE_20_MODULE_PERMISSIONS.md.
export function ModuleChecklist({ selected, onChange }: ModuleChecklistProps) {
  const toggle = (module: AppModule) => {
    onChange(
      selected.includes(module)
        ? selected.filter((current) => current !== module)
        : [...selected, module],
    );
  };

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {ALL_MODULES.map((module) => (
        <label
          key={module}
          className="flex cursor-pointer items-center gap-2 rounded border border-border bg-input px-3 py-2"
        >
          <input
            type="checkbox"
            checked={selected.includes(module)}
            onChange={() => toggle(module)}
            className="shrink-0"
          />
          <span className="text-control text-white">
            {MODULE_LABELS[module]}
          </span>
        </label>
      ))}
    </div>
  );
}
