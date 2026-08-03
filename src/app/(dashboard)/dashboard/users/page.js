"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Modal, ConfirmModal, Toggle, Badge } from "@/shared/components";

const EMPTY_RESTRICTIONS = { models: [], providers: [], rateLimitPerMinute: null, quota: { monthlyRequests: null, monthlyTokens: null } };

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 12) return "••••" + key.slice(-4);
  return key.slice(0, 9) + "••••" + key.slice(-4);
}

function fmtDate(iso) {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function isExpired(token) {
  return token.expiresAt && new Date(token.expiresAt).getTime() < Date.now();
}

function TokenRow({ token, onEdit, onDelete }) {
  const expired = isExpired(token);
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-sidebar/40 px-3 py-2 text-sm">
      <span className="font-mono text-xs text-text-main">
        {revealed ? token.key : maskKey(token.key)}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="text-text-muted hover:text-primary"
        title={revealed ? "Hide key" : "Show key"}
      >
        <span className="material-symbols-outlined text-[16px]">{revealed ? "visibility_off" : "visibility"}</span>
      </button>
      {token.name && <span className="text-text-muted text-xs">· {token.name}</span>}
      <span className="text-xs text-text-muted">· Expires {fmtDate(token.expiresAt)}</span>
      {expired ? <Badge variant="error">expired</Badge> : !token.isActive ? <Badge variant="default">paused</Badge> : <Badge variant="success">active</Badge>}
      <span className="ml-auto flex items-center gap-1">
        <button type="button" onClick={() => onEdit(token)} className="text-xs text-text-muted hover:text-primary" title="Extend / manage">
          <span className="material-symbols-outlined text-[16px]">edit</span>
        </button>
        <button type="button" onClick={() => onDelete(token)} className="text-xs text-text-muted hover:text-red-500" title="Revoke">
          <span className="material-symbols-outlined text-[16px]">delete</span>
        </button>
      </span>
    </div>
  );
}

function RestrictionsView({ restrictions }) {
  const r = { ...EMPTY_RESTRICTIONS, ...(restrictions || {}) };
  const chips = [];
  if (r.models?.length) chips.push(`${r.models.length} model allow-list`);
  if (r.providers?.length) chips.push(`${r.providers.length} provider allow-list`);
  if (r.rateLimitPerMinute) chips.push(`max ${r.rateLimitPerMinute} req/min`);
  if (r.quota?.monthlyRequests) chips.push(`quota ${r.quota.monthlyRequests} req/mo`);
  if (r.quota?.monthlyTokens) chips.push(`quota ${r.quota.monthlyTokens} tok/mo`);
  return (
    <span className="text-xs text-text-muted">
      {chips.length ? chips.join(" · ") : "Unrestricted"}
    </span>
  );
}

export default function UsersPage() {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState([]);
  const [tokensByUser, setTokensByUser] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // {type, user, token}

  // Member-scoped views
  const [myModels, setMyModels] = useState([]);
  const [myModelsScoped, setMyModelsScoped] = useState(false);
  const [myUsage, setMyUsage] = useState(null);
  const [usagePeriod, setUsagePeriod] = useState("30d");

  const loadMe = useCallback(async () => {
    const res = await fetch("/api/users/me");
    if (res.ok) {
      const data = await res.json();
      setMe(data.user);
      if (data.user.role !== "admin") {
        setTokensByUser((m) => ({ ...m, [data.user.id]: data.user.tokens || [] }));
        setExpanded(data.user.id);
      }
    } else {
      setError("Failed to load profile");
    }
  }, []);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/users");
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users);
    } else {
      setError("Failed to load users");
    }
  }, []);

  const loadTokens = useCallback(async (userId) => {
    const res = await fetch(`/api/users/${userId}/tokens`);
    if (res.ok) {
      const data = await res.json();
      setTokensByUser((m) => ({ ...m, [userId]: data.tokens || [] }));
    }
  }, []);

  const loadMyModels = useCallback(async () => {
    const res = await fetch("/api/users/me/models");
    if (res.ok) {
      const d = await res.json();
      setMyModels(d.models || []);
      setMyModelsScoped(!!d.scoped);
    }
  }, []);

  const loadMyUsage = useCallback(async (period) => {
    const p = period || "30d";
    const res = await fetch(`/api/users/me/usage?period=${p}`);
    if (res.ok) {
      const d = await res.json();
      setMyUsage(d.usage);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadMe();
      setLoading(false);
    })();
  }, [loadMe]);

  useEffect(() => {
    (async () => {
      if (me?.role === "admin") await loadUsers();
    })();
  }, [me, loadUsers]);

  useEffect(() => {
    (async () => {
      if (expanded && me?.role === "admin" && tokensByUser[expanded] === undefined) await loadTokens(expanded);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, me]);

  useEffect(() => {
    (async () => {
      if (me?.role === "member") {
        await Promise.all([loadMyModels(), loadMyUsage(usagePeriod)]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, usagePeriod]);

  const refresh = async () => {
    await loadMe();
    if (me?.role === "admin") await loadUsers();
    if (expanded) await loadTokens(expanded);
    if (me?.role === "member") {
      await Promise.all([loadMyModels(), loadMyUsage(usagePeriod)]);
    }
  };

  const openUser = async (userId) => {
    if (expanded === userId) {
      setExpanded(null);
      return;
    }
    setExpanded(userId);
    if (tokensByUser[userId] === undefined) await loadTokens(userId);
  };

  const closeModal = () => setModal(null);

  const handleDeleteUser = async (user) => {
    const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to delete user");
      return;
    }
    await refresh();
  };

  const handleDeleteToken = async (token, userId) => {
    const res = await fetch(`/api/users/${userId}/tokens/${token.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to delete token");
      return;
    }
    await loadTokens(userId);
    if (userId === me?.id) await loadMe();
  };

  if (loading) {
    return <div className="flex items-center justify-center p-10 text-text-muted">Loading users…</div>;
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-lg">
        <Card>
          <p className="text-center text-text-muted">You are not signed in. <a className="text-primary underline" href="/login">Sign in</a></p>
        </Card>
      </div>
    );
  }

  const isAdmin = me.role === "admin";
  const myTokens = tokensByUser[me.id] || [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-text-main">Users & Access</h1>
        <p className="text-sm text-text-muted mt-1">
          {isAdmin
            ? "Create member accounts, issue expiring API tokens, and enforce per-user limits."
            : "Manage your own API tokens and password."}
        </p>
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
      </div>

      {!isAdmin && (
        <>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-text-main">My account</p>
                <p className="text-xs text-text-muted">Username: <span className="font-mono">{me.username}</span></p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setModal({ type: "changePassword", user: me })}>Change password</Button>
                <Badge variant={me.isActive ? "success" : "error"}>{me.isActive ? "active" : "disabled"}</Badge>
              </div>
            </div>
            <div className="mt-4">
              <RestrictionsView restrictions={me.restrictions} />
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-text-main">My API tokens</h2>
              <Button size="sm" onClick={() => setModal({ type: "issueToken", user: me })}>New token</Button>
            </div>
            <div className="flex flex-col gap-2">
              {myTokens.length === 0 && <p className="text-sm text-text-muted">No tokens yet.</p>}
              {myTokens.map((t) => (
                <TokenRow
                  key={t.id}
                  token={t}
                  onEdit={(tok) => setModal({ type: "editToken", user: me, token: tok })}
                  onDelete={(tok) => setModal({ type: "confirmTokenDelete", user: me, token: tok })}
                />
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-text-main">Models available to me</h2>
              {myModelsScoped && <Badge variant="primary">scoped by admin</Badge>}
            </div>
            <div className="max-h-72 overflow-y-auto custom-scrollbar flex flex-col gap-1">
              {myModels.length === 0 && <p className="text-sm text-text-muted">No models available. Contact your administrator.</p>}
              {myModels.map((m) => (
                <div key={m.id} className="rounded border border-border bg-sidebar/40 px-3 py-1.5 text-xs font-mono text-text-main">
                  {m.id}
                  {m.name ? <span className="text-text-muted font-sans"> · {m.name}</span> : null}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-text-main">My usage</h2>
              <div className="flex items-center gap-1">
                {["24h", "7d", "30d", "all"].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setUsagePeriod(p)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      usagePeriod === p ? "bg-primary/10 text-primary" : "text-text-muted hover:bg-surface-2"
                    }`}
                  >
                    {p === "all" ? "All" : p}
                  </button>
                ))}
              </div>
            </div>
            {myUsage ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border bg-sidebar/40 p-3">
                  <p className="text-xs text-text-muted">Requests</p>
                  <p className="text-xl font-bold text-text-main">{myUsage.totalRequests}</p>
                </div>
                <div className="rounded-lg border border-border bg-sidebar/40 p-3">
                  <p className="text-xs text-text-muted">Prompt tokens</p>
                  <p className="text-xl font-bold text-text-main">{myUsage.totalPromptTokens}</p>
                </div>
                <div className="rounded-lg border border-border bg-sidebar/40 p-3">
                  <p className="text-xs text-text-muted">Completion tokens</p>
                  <p className="text-xl font-bold text-text-main">{myUsage.totalCompletionTokens}</p>
                </div>
                <div className="rounded-lg border border-border bg-sidebar/40 p-3">
                  <p className="text-xs text-text-muted">Cost</p>
                  <p className="text-xl font-bold text-text-main">${(myUsage.totalCost || 0).toFixed(4)}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-muted">Loading usage…</p>
            )}
          </Card>
        </>
      )}

      {isAdmin && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-text-main">Users</h2>
            <Button size="sm" onClick={() => setModal({ type: "createUser" })}>Add member</Button>
          </div>
          <div className="flex flex-col gap-2">
            {users.length === 0 && <p className="text-sm text-text-muted">No users yet.</p>}
            {users.map((u) => (
              <div key={u.id} className="rounded-lg border border-border bg-sidebar/40">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-3 px-3 py-2.5 text-left hover:bg-sidebar/60"
                  onClick={() => openUser(u.id)}
                >
                  <span className="font-mono text-sm text-text-main">{u.username}</span>
                  <Badge variant={u.role === "admin" ? "primary" : "default"}>{u.role}</Badge>
                  {u.isActive ? <Badge variant="success">active</Badge> : <Badge variant="error">disabled</Badge>}
                  <span className="text-xs text-text-muted">{u.tokenCount} token{u.tokenCount === 1 ? "" : "s"}</span>
                  <span className="ml-auto"><RestrictionsView restrictions={u.restrictions} /></span>
                  <span className="material-symbols-outlined text-text-muted text-[18px]">{expanded === u.id ? "expand_less" : "expand_more"}</span>
                </button>
                {expanded === u.id && (
                  <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setModal({ type: "editUser", user: u })}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setModal({ type: "issueToken", user: u })}>New token</Button>
                      {u.id !== me.id && (
                        <Button size="sm" variant="error" onClick={() => setModal({ type: "confirmUserDelete", user: u })}>Delete</Button>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {!tokensByUser[u.id] && <p className="text-xs text-text-muted">Loading tokens…</p>}
                      {(tokensByUser[u.id] || []).length === 0 && <p className="text-xs text-text-muted">No tokens.</p>}
                      {(tokensByUser[u.id] || []).map((t) => (
                        <TokenRow
                          key={t.id}
                          token={t}
                          onEdit={(tok) => setModal({ type: "editToken", user: u, token: tok })}
                          onDelete={(tok) => setModal({ type: "confirmTokenDelete", user: u, token: tok })}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {modal?.type === "changePassword" && (
        <ChangePasswordModal
          isOpen
          user={modal.user}
          onClose={closeModal}
          onSaved={async () => { await loadMe(); closeModal(); }}
        />
      )}
      {modal?.type === "createUser" && <CreateUserModal isOpen onClose={closeModal} onSaved={async () => { await refresh(); }} />}
      {modal?.type === "editUser" && <EditUserModal isOpen user={modal.user} onClose={closeModal} onSaved={async () => { await refresh(); }} />}
      {modal?.type === "issueToken" && <IssueTokenModal isOpen user={modal.user} onClose={closeModal} onSaved={async (uId, t) => { if (uId === me.id) await refresh(); else await loadTokens(uId); }} />}
      {modal?.type === "editToken" && (
        <EditTokenModal isOpen user={modal.user} token={modal.token} onClose={closeModal} onSaved={async (uId) => { await loadTokens(uId); if (uId === me.id) await loadMe(); }} />
      )}
      {modal?.type === "confirmUserDelete" && (
        <ConfirmModal
          isOpen
          title="Delete user"
          message={`Delete ${modal.user.username}? All of their tokens will be revoked.`}
          confirmText="Delete"
          onConfirm={async () => { await handleDeleteUser(modal.user); closeModal(); }}
          onClose={closeModal}
        />
      )}
      {modal?.type === "confirmTokenDelete" && (
        <ConfirmModal
          isOpen
          title="Revoke token"
          message="Revoke this API token? Clients using it will be rejected immediately."
          confirmText="Revoke"
          onConfirm={async () => { await handleDeleteToken(modal.token, modal.user.id); closeModal(); }}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

function RestrictionsForm({ value, onChange }) {
  const r = { ...EMPTY_RESTRICTIONS, ...(value || {}), quota: { ...EMPTY_RESTRICTIONS.quota, ...((value || {}).quota || {}) } };
  const set = (patch) => onChange({ ...r, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-text-main">Model allow-list</label>
        <Input
          placeholder="e.g. gpt-4o, claude-3-5-* (comma separated, blank = all)"
          value={(r.models || []).join(", ")}
          onChange={(e) => set({ models: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-text-main">Provider allow-list</label>
        <Input
          placeholder="e.g. openai, claude, gemini (comma separated, blank = all)"
          value={(r.providers || []).join(", ")}
          onChange={(e) => set({ providers: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          label="Rate limit (req/min)"
          type="number"
          placeholder="Unlimited"
          value={r.rateLimitPerMinute ?? ""}
          onChange={(e) => set({ rateLimitPerMinute: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <Input
          label="Monthly requests"
          type="number"
          placeholder="Unlimited"
          value={r.quota.monthlyRequests ?? ""}
          onChange={(e) => set({ quota: { ...r.quota, monthlyRequests: e.target.value === "" ? null : Number(e.target.value) } })}
        />
        <Input
          label="Monthly tokens"
          type="number"
          placeholder="Unlimited"
          value={r.quota.monthlyTokens ?? ""}
          onChange={(e) => set({ quota: { ...r.quota, monthlyTokens: e.target.value === "" ? null : Number(e.target.value) } })}
        />
      </div>
    </div>
  );
}

function CreateUserModal({ isOpen, onClose, onSaved }) {
  const [form, setForm] = useState({ username: "", password: "", restrictions: EMPTY_RESTRICTIONS });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const d = await res.json();
      setErr(d.error || "Failed to create user");
      setSaving(false);
      return;
    }
    await onSaved();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} title="Add member" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input label="Username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. alice" />
        <Input label="Password" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 6 characters" />
        <RestrictionsForm value={form.restrictions} onChange={(restrictions) => setForm({ ...form, restrictions })} />
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Create member</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({ isOpen, user, onClose, onSaved }) {
  const [form, setForm] = useState({
    username: user.username,
    password: "",
    isActive: user.isActive !== false,
    restrictions: user.restrictions || EMPTY_RESTRICTIONS,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr("");
    const body = { username: form.username, restrictions: form.restrictions, isActive: form.isActive };
    if (form.password) body.password = form.password;
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json();
      setErr(d.error || "Failed to update user");
      setSaving(false);
      return;
    }
    await onSaved();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} title={`Edit ${user.username}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input label="Username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <Input label="New password (leave blank to keep)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 6 characters" />
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-main">Account enabled</span>
          <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} disabled={user.id === user.id && user.role === "admin"} />
        </div>
        <RestrictionsForm value={form.restrictions} onChange={(restrictions) => setForm({ ...form, restrictions })} />
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function IssueTokenModal({ isOpen, user, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", expiresInDays: "30" });
  const [created, setCreated] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr("");
    const body = { name: form.name };
    if (form.expiresInDays !== "" && form.expiresInDays !== null) body.expiresInDays = Number(form.expiresInDays);
    const res = await fetch(`/api/users/${user.id}/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json();
      setErr(d.error || "Failed to create token");
      setSaving(false);
      return;
    }
    const d = await res.json();
    setCreated(d.token);
    await onSaved(user.id, d.token);
  };

  if (created) {
    return (
      <Modal isOpen={isOpen} title="API token created" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">Save this key now — it will not be shown again.</p>
          <div className="rounded-lg border border-border bg-sidebar p-3 font-mono text-xs text-text-main break-all">{created.key}</div>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} title={`New token · ${user.username}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. cline on laptop" />
        <Input
          label="Expires in (days)"
          type="number"
          min="1"
          value={form.expiresInDays}
          onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}
          hint="Leave empty for a token that never expires"
        />
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Create token</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditTokenModal({ isOpen, user, token, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: token.name || "",
    isActive: token.isActive,
    expiresInDays: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr("");
    const body = { name: form.name, isActive: form.isActive };
    if (form.expiresInDays !== "") body.expiresInDays = Number(form.expiresInDays);
    const res = await fetch(`/api/users/${user.id}/tokens/${token.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json();
      setErr(d.error || "Failed to update token");
      setSaving(false);
      return;
    }
    await onSaved(user.id);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} title={`Manage token · ${user.username}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-main">Enabled</span>
          <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} />
        </div>
        <Input
          label="Extend expiry (days from now)"
          type="number"
          min="1"
          value={form.expiresInDays}
          onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}
          hint={`Current expiry: ${fmtDate(token.expiresAt)}. Leave blank to keep.`}
        />
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function ChangePasswordModal({ isOpen, user, onClose, onSaved }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr("");
    setSuccess(false);
    if (form.newPassword !== form.confirmPassword) {
      setErr("New passwords do not match");
      setSaving(false);
      return;
    }
    if (form.newPassword.length < 6) {
      setErr("New password must be at least 6 characters");
      setSaving(false);
      return;
    }
    const res = await fetch("/api/users/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error || "Failed to change password");
      setSaving(false);
      return;
    }
    setSuccess(true);
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    await onSaved();
  };

  return (
    <Modal isOpen={isOpen} title={`Change password · ${user.username}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Current password"
          type="password"
          value={form.currentPassword}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
          required
        />
        <Input
          label="New password"
          type="password"
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          required
          placeholder="At least 6 characters"
        />
        <Input
          label="Confirm new password"
          type="password"
          value={form.confirmPassword}
          onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
          required
        />
        {err && <p className="text-xs text-red-500">{err}</p>}
        {success && <p className="text-xs text-green-500">Password changed successfully.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Change password</Button>
        </div>
      </form>
    </Modal>
  );
}
