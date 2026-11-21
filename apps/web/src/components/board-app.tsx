"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { boardEventSchema, isOverdue } from "@flowboard/shared";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  ListFilter,
  MoreHorizontal,
  Moon,
  PanelsTopLeft,
  Plus,
  Share2,
  Sun,
} from "lucide-react";
import CardDetailsDialog, {
  type BoardLabel,
  type BoardMember,
} from "./card-details-dialog";

const API = "/api";
type Card = {
  id: string;
  title: string;
  description?: string | null;
  order: number;
  labels: string[];
  dueDate?: string | null;
  assigneeId?: string | null;
};
type Column = { id: string; name: string; order: number; cards: Card[] };
type Board = { id: string; name: string; role: string; columns: Column[] };
type Viewer = { userId: string; displayName: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok)
    throw new Error(
      ((await response.json()) as { error?: string }).error ?? "Request failed",
    );
  return response.json() as Promise<T>;
}

function CardItem({
  card,
  labels,
  members,
  onOpen,
}: {
  card: Card;
  labels: BoardLabel[];
  members: BoardMember[];
  onOpen: (card: Card) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { card } });
  const assignee = members.find((member) => member.id === card.assigneeId);
  return (
    <article
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
      className="card"
      {...attributes}
      {...listeners}
      aria-label={`Open card: ${card.title}`}
      onClick={() => onOpen(card)}
    >
      <p>{card.title}</p>
      {card.labels.length > 0 && (
        <div className="labels">
          {card.labels.map((label) => (
            <span
              className="label-chip"
              key={label}
              style={
                {
                  "--label-color":
                    labels.find((item) => item.name === label)?.color ??
                    "#d8e9c9",
                } as React.CSSProperties
              }
            >
              {label}
            </span>
          ))}
        </div>
      )}
      {(assignee || card.dueDate) && (
        <div className="card-meta">
          {assignee && (
            <span
              className="assignee-avatar"
              title={assignee.displayName}
              aria-label={`Assigned to ${assignee.displayName}`}
            >
              {assignee.displayName.slice(0, 1).toUpperCase()}
            </span>
          )}
          {card.dueDate && (
            <small
              className={`due-date ${isOverdue(card.dueDate) ? "overdue" : ""}`}
            >
              <CalendarDays size={12} aria-hidden="true" />
              Due {new Date(card.dueDate).toLocaleDateString()}
            </small>
          )}
        </div>
      )}
    </article>
  );
}

export default function BoardApp() {
  const [board, setBoard] = useState<Board | null>(null);
  const [boards, setBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [email, setEmail] = useState("demo@flowboard.dev");
  const [password, setPassword] = useState("flowboard-demo-password");
  const [notice, setNotice] = useState("");
  const [dark, setDark] = useState(false);
  const [connected, setConnected] = useState(false);
  const [user, setUser] = useState<{ displayName: string } | null>(null);
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [labels, setLabels] = useState<BoardLabel[]>([]);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [savingCard, setSavingCard] = useState(false);
  const [cardError, setCardError] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const loadBoard = useCallback(async (id?: string) => {
    const available =
      await request<Array<{ id: string; name: string }>>("/boards");
    setBoards(available);
    if (available.length) {
      const boardId = id ?? available[0]!.id;
      const [selected, boardMembers, boardLabels] = await Promise.all([
        request<Board>(`/boards/${boardId}`),
        request<BoardMember[]>(`/boards/${boardId}/members`),
        request<BoardLabel[]>(`/boards/${boardId}/labels`),
      ]);
      setBoard(selected);
      setMembers(boardMembers);
      setLabels(boardLabels);
    }
  }, []);

  const signIn = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      try {
        const signedIn = await request<{ displayName: string }>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setUser(signedIn);
        setNotice("Welcome back. Your board is ready.");
        await loadBoard();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Sign in failed");
      }
    },
    [email, password, loadBoard],
  );

  useEffect(() => {
    void signIn();
  }, [signIn]);
  useEffect(() => {
    if (!board) return;
    let socket: WebSocket | undefined;
    let cancelled = false;
    void fetch(`${API}/runtime-config`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Runtime configuration unavailable");
        return (await response.json()) as { webSocketUrl: string };
      })
      .then(({ webSocketUrl }) =>
        request<{ ticket: string }>(`/boards/${board.id}/live-ticket`, {
          method: "POST",
          body: JSON.stringify({}),
        }).then(({ ticket }) => ({ ticket, webSocketUrl })),
      )
      .then(({ ticket, webSocketUrl }) => {
        if (cancelled) return;
        const socketUrl = new URL(
          `/boards/${board.id}/live?ticket=${encodeURIComponent(ticket)}`,
          webSocketUrl || window.location.origin,
        );
        socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
        const connection = new WebSocket(socketUrl);
        socket = connection;
        connection.onopen = () => setConnected(true);
        connection.onclose = () => setConnected(false);
        connection.onmessage = (event) => {
          const parsed = boardEventSchema.safeParse(JSON.parse(event.data));
          if (!parsed.success) return;
          if (parsed.data.type === "presence.snapshot") {
            setViewers(parsed.data.users);
            return;
          }
          void loadBoard(board.id);
        };
      })
      .catch(() => setConnected(false));
    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [board?.id, loadBoard]);

  const allIds = useMemo(
    () =>
      board?.columns.flatMap((column) => column.cards.map((card) => card.id)) ??
      [],
    [board],
  );
  const activeViewers = viewers.length
    ? viewers
    : [{ userId: "current-user", displayName: user?.displayName ?? "Member" }];
  async function createCard(column: Column) {
    const title = window.prompt("What needs to get done?");
    if (!title?.trim()) return;
    try {
      await request(`/boards/${board?.id}/cards`, {
        method: "POST",
        body: JSON.stringify({ title, columnId: column.id, labels: [] }),
      });
      await loadBoard(board?.id);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not create card",
      );
    }
  }
  async function onDragEnd(event: DragEndEvent) {
    const moved = event.active.data.current?.card as Card | undefined;
    const target = board?.columns.find((column) =>
      column.cards.some((card) => card.id === event.over?.id),
    );
    if (!moved || !target || moved.id === event.over?.id) return;
    const order = (target.cards.at(-1)?.order ?? 0) + 1024;
    setBoard((current) =>
      current
        ? {
            ...current,
            columns: current.columns.map((column) => ({
              ...column,
              cards: column.cards
                .filter((card) => card.id !== moved.id)
                .concat(column.id === target.id ? [{ ...moved, order }] : []),
            })),
          }
        : current,
    );
    try {
      await request(`/boards/${board?.id}/cards/${moved.id}/move`, {
        method: "PATCH",
        body: JSON.stringify({ columnId: target.id, order }),
      });
      await loadBoard(board?.id);
    } catch {
      setNotice("Move could not be saved. Restoring the latest board.");
      await loadBoard(board?.id);
    }
  }
  async function saveCard(changes: {
    title: string;
    description: string;
    assigneeId: string | null;
    labels: string[];
    dueDate: string | null;
  }) {
    if (!board || !selectedCard) return;
    setSavingCard(true);
    setCardError("");
    try {
      await request(`/boards/${board.id}/cards/${selectedCard.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      await loadBoard(board.id);
      setSelectedCard(null);
    } catch (error) {
      setCardError(
        error instanceof Error ? error.message : "Could not save card",
      );
    } finally {
      setSavingCard(false);
    }
  }

  async function createLabel(name: string, color: string) {
    if (!board) return;
    const created = await request<BoardLabel>(`/boards/${board.id}/labels`, {
      method: "POST",
      body: JSON.stringify({ name, color }),
    });
    setLabels((current) => [
      ...current.filter((label) => label.id !== created.id),
      created,
    ]);
  }

  if (!user || !board)
    return (
      <main className="login-screen">
        <div className="login-card">
          <div className="brand-mark">f</div>
          <p className="eyebrow">A calmer way to collaborate</p>
          <h1>Make work flow.</h1>
          <p className="muted">
            Bring your team, tasks, and momentum into one shared space.
          </p>
          <form onSubmit={(event) => void signIn(event)}>
            <label>
              Email
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
              />
            </label>
            <button className="primary wide">
              Open your workspace <ArrowRight size={15} aria-hidden="true" />
            </button>
          </form>
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          <p className="demo-hint">
            Demo access is prefilled so you can explore right away.
          </p>
        </div>
      </main>
    );

  return (
    <main className={dark ? "app-shell dark" : "app-shell"}>
      <aside className="sidebar">
        <a href="#home" className="brand">
          <span className="brand-mark">f</span> flowboard
        </a>
        <p className="side-label">WORKSPACE</p>
        <button className="workspace-switch">
          <span className="workspace-icon">
            <PanelsTopLeft size={14} aria-hidden="true" />
          </span>{" "}
          Product Studio{" "}
          <ChevronDown className="chevron" size={14} aria-hidden="true" />
        </button>
        <p className="side-label boards-label">YOUR BOARDS</p>
        {boards.map((item) => (
          <button
            key={item.id}
            className={`board-link ${board.id === item.id ? "selected" : ""}`}
            onClick={() => void loadBoard(item.id)}
          >
            <LayoutDashboard
              className="board-dot"
              size={15}
              aria-hidden="true"
            />
            {item.name}
          </button>
        ))}
        <button
          className="add-board"
          onClick={async () => {
            const name = window.prompt("Board name");
            if (name) {
              await request("/boards", {
                method: "POST",
                body: JSON.stringify({ name }),
              });
              await loadBoard();
            }
          }}
        >
          <Plus size={14} aria-hidden="true" /> New board
        </button>
        <div className="sidebar-bottom">
          <div className="avatar">{user.displayName[0]}</div>
          <div>
            <strong>{user.displayName}</strong>
            <small>Product Studio</small>
          </div>
          <button
            title="Toggle color theme"
            aria-label="Toggle color theme"
            className="theme-toggle"
            onClick={() => setDark(!dark)}
          >
            {dark ? (
              <Sun size={16} aria-hidden="true" />
            ) : (
              <Moon size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div className="crumb">
            Boards <span>/</span> <strong>{board.name}</strong>
          </div>
          <div className="top-actions">
            <span className={`live-status ${connected ? "online" : ""}`}>
              <i />
              {connected ? "Live" : "Connecting"}
            </span>
            <div className="avatar small">{user.displayName[0]}</div>
            {board.role === "owner" && (
              <button
                className="share-button"
                onClick={async () => {
                  try {
                    const result = await request<{ inviteUrl: string }>(
                      `/boards/${board.id}/invites`,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          email: window.prompt("Teammate email") ?? "",
                          role: "editor",
                        }),
                      },
                    );
                    await navigator.clipboard.writeText(result.inviteUrl);
                    setNotice("Invite link copied.");
                  } catch (error) {
                    setNotice(
                      error instanceof Error
                        ? error.message
                        : "Could not invite",
                    );
                  }
                }}
              >
                <Share2 size={14} aria-hidden="true" /> Share
              </button>
            )}
          </div>
        </header>
        <div className="board-heading">
          <div>
            <div className="eyebrow">TUESDAY, JUNE 18</div>
            <h1>{board.name}</h1>
            <p className="muted">
              A little progress adds up. Keep the momentum going.
            </p>
          </div>
          <div className="heading-tools">
            <div
              className="avatars"
              aria-label={`Active viewers: ${activeViewers.map((viewer) => viewer.displayName).join(", ")}`}
            >
              {activeViewers.slice(0, 3).map((viewer, index) => (
                <span
                  className={`avatar ${index === 1 ? "avatar-alt" : index === 2 ? "avatar-alt2" : ""}`}
                  key={viewer.userId}
                  title={viewer.displayName}
                >
                  {viewer.displayName[0]?.toUpperCase() ?? "?"}
                </span>
              ))}
              {activeViewers.length > 3 && (
                <span className="avatar more">+{activeViewers.length - 3}</span>
              )}
            </div>
            <button className="filter-button">
              <ListFilter size={14} aria-hidden="true" /> Filter
            </button>
            <button className="dots" aria-label="Board options">
              <MoreHorizontal size={19} aria-hidden="true" />
            </button>
          </div>
        </div>
        {notice && (
          <p role="status" className="toast" onClick={() => setNotice("")}>
            {notice}
          </p>
        )}
        <DndContext
          sensors={sensors}
          onDragEnd={(event) => void onDragEnd(event)}
        >
          <div className="board-grid">
            {board.columns.map((column, index) => (
              <section
                className="column"
                key={column.id}
                aria-label={column.name}
              >
                <header className="column-head">
                  <span className={`column-dot dot-${index % 3}`} />
                  <h2>{column.name}</h2>
                  <span className="count">{column.cards.length}</span>
                  <button
                    aria-label={`Add card to ${column.name}`}
                    className="column-menu"
                    disabled={board.role === "viewer"}
                    onClick={() => void createCard(column)}
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </header>
                <SortableContext
                  items={column.cards.map((card) => card.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="card-list">
                    {column.cards.map((card) => (
                      <CardItem
                        key={card.id}
                        card={card}
                        labels={labels}
                        members={members}
                        onOpen={(openedCard) => {
                          setCardError("");
                          setSelectedCard(openedCard);
                        }}
                      />
                    ))}
                  </div>
                </SortableContext>
                <button
                  className="add-card"
                  disabled={board.role === "viewer"}
                  onClick={() => void createCard(column)}
                >
                  <Plus size={13} aria-hidden="true" /> Add a card
                </button>
              </section>
            ))}
            <button
              className="new-column"
              disabled={board.role === "viewer"}
              onClick={async () => {
                const name = window.prompt("Column name");
                if (name) {
                  await request(`/boards/${board.id}/columns`, {
                    method: "POST",
                    body: JSON.stringify({
                      name,
                      order: (board.columns.at(-1)?.order ?? 0) + 1024,
                    }),
                  });
                  await loadBoard(board.id);
                }
              }}
            >
              <Plus size={14} aria-hidden="true" /> Add column
            </button>
          </div>
        </DndContext>
        <footer className="board-footer">
          Showing {allIds.length} cards <span>·</span> Changes save
          automatically
        </footer>
      </section>
      <CardDetailsDialog
        card={selectedCard}
        members={members}
        labels={labels}
        open={selectedCard !== null}
        readOnly={board.role === "viewer"}
        saving={savingCard}
        error={cardError}
        onClose={() => setSelectedCard(null)}
        onSave={saveCard}
        onCreateLabel={createLabel}
      />
    </main>
  );
}
