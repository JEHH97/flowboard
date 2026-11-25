"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { toDateInputValue } from "@flowboard/shared";

export type BoardMember = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

export type BoardLabel = {
  id: string;
  name: string;
  color: string;
};

export type EditableCard = {
  id: string;
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  labels: string[];
  dueDate?: string | null;
};

type CardChanges = {
  title: string;
  description: string;
  assigneeId: string | null;
  labels: string[];
  dueDate: string | null;
};

export default function CardDetailsDialog({
  card,
  members,
  labels,
  open,
  readOnly,
  saving,
  error,
  onClose,
  onSave,
  onCreateLabel,
  onDelete,
  deleting,
}: {
  card: EditableCard | null;
  members: BoardMember[];
  labels: BoardLabel[];
  open: boolean;
  readOnly: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (changes: CardChanges) => Promise<void>;
  onCreateLabel: (name: string, color: string) => Promise<void>;
  onDelete: () => Promise<void>;
  deleting: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("#7aa58a");
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [labelError, setLabelError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      titleRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!card) return;
    setTitle(card.title);
    setDescription(card.description ?? "");
    setAssigneeId(card.assigneeId ?? "");
    setSelectedLabels(card.labels);
    setDueDate(toDateInputValue(card.dueDate));
    setLabelError("");
    setConfirmingDelete(false);
  }, [card?.id]);

  if (!card) return null;

  function toggleLabel(labelName: string) {
    setSelectedLabels((current) =>
      current.includes(labelName)
        ? current.filter((value) => value !== labelName)
        : [...current, labelName],
    );
  }

  async function createLabel() {
    if (!newLabel.trim()) return;
    setCreatingLabel(true);
    try {
      await onCreateLabel(newLabel.trim(), newColor);
      setSelectedLabels((current) =>
        current.includes(newLabel.trim())
          ? current
          : [...current, newLabel.trim()],
      );
      setNewLabel("");
      setLabelError("");
    } catch (error) {
      setLabelError(
        error instanceof Error ? error.message : "Could not create label",
      );
    } finally {
      setCreatingLabel(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave({
      title: title.trim(),
      description: description.trim(),
      assigneeId: assigneeId || null,
      labels: selectedLabels,
      dueDate: dueDate
        ? new Date(`${dueDate}T23:59:59.999Z`).toISOString()
        : null,
    });
  }

  function trapTabKey(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      className="card-details-dialog"
      ref={dialogRef}
      aria-labelledby="card-details-title"
      aria-describedby="card-details-description"
      onKeyDown={trapTabKey}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <p className="eyebrow">CARD DETAILS</p>
          <h2 id="card-details-title">
            {readOnly ? "View card" : "Edit card"}
          </h2>
        </div>
        <button
          className="icon-button dialog-close"
          type="button"
          aria-label="Close card details"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <p className="sr-only" id="card-details-description">
        Edit the card title, description, assignee, labels, and due date.
      </p>
      <form
        className="card-details-form"
        onSubmit={(event) => void submit(event)}
      >
        <label className="detail-field">
          Title
          <input
            ref={titleRef}
            autoFocus
            aria-label="Card title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={180}
            required
            disabled={readOnly || saving}
          />
        </label>
        <label className="detail-field">
          Description
          <textarea
            aria-label="Card description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4000}
            rows={3}
            disabled={readOnly || saving}
          />
        </label>
        <label className="detail-field">
          Assignee
          <select
            aria-label="Assignee"
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            disabled={readOnly || saving}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName} · {member.role}
              </option>
            ))}
          </select>
        </label>
        <fieldset
          className="detail-field label-picker"
          disabled={readOnly || saving}
        >
          <legend>Labels</legend>
          <div className="label-options">
            {labels.map((label) => (
              <label className="label-option" key={label.id}>
                <input
                  type="checkbox"
                  checked={selectedLabels.includes(label.name)}
                  onChange={() => toggleLabel(label.name)}
                />
                <span
                  className="label-chip"
                  style={
                    { "--label-color": label.color } as React.CSSProperties
                  }
                >
                  {label.name}
                </span>
              </label>
            ))}
            {labels.length === 0 && (
              <span className="muted">No labels yet</span>
            )}
          </div>
          {!readOnly && (
            <div className="label-create-row">
              <label className="sr-only" htmlFor="new-label-name">
                New label name
              </label>
              <input
                id="new-label-name"
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
                placeholder="Create a label"
                maxLength={32}
              />
              <label className="sr-only" htmlFor="new-label-color">
                New label color
              </label>
              <input
                id="new-label-color"
                type="color"
                aria-label="New label color"
                value={newColor}
                onChange={(event) => setNewColor(event.target.value)}
              />
              <button
                className="secondary-button"
                type="button"
                disabled={!newLabel.trim() || creatingLabel}
                onClick={() => void createLabel()}
              >
                {creatingLabel ? "Adding…" : "Create label"}
              </button>
            </div>
          )}
        </fieldset>
        {labelError && (
          <p className="dialog-error" role="alert">
            {labelError}
          </p>
        )}
        <label className="detail-field">
          Due date
          <input
            aria-label="Due date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            disabled={readOnly || saving}
          />
        </label>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <footer className="dialog-actions">
          {!readOnly &&
            (confirmingDelete ? (
              <>
                <span className="dialog-confirm-prompt">Delete this card?</span>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
                <button
                  className="danger-button"
                  type="button"
                  disabled={deleting}
                  onClick={() => void onDelete()}
                >
                  {deleting ? "Deleting…" : "Confirm delete"}
                </button>
              </>
            ) : (
              <button
                className="danger-button"
                type="button"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete card
              </button>
            ))}
          <span className="dialog-actions-spacer" />
          <button className="secondary-button" type="button" onClick={onClose}>
            Close
          </button>
          {!readOnly && !confirmingDelete && (
            <button
              className="primary"
              type="submit"
              disabled={saving || !title.trim()}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}
