"use client";

import { useState } from "react";

export default function InlineCreateField({
  placeholder,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  onSubmit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    void onSubmit(trimmed);
  }

  return (
    <form className="inline-create-field" onSubmit={submit}>
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </form>
  );
}
