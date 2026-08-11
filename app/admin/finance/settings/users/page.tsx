"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, KeyRound, Plus } from "lucide-react";
import { requireAdmin } from "@/lib/roleGuard";
import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import FinanceNav from "@/components/finance/FinanceNav";
import Modal from "@/components/finance/Modal";

interface FinanceUserRow {
  id: string;
  fullName: string;
  username: string;
  active: boolean;
  role: string;
  lastLogin?: { toDate?: () => Date } | null;
  createdByName: string;
  createdAt?: { toDate?: () => Date };
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || "Request failed.");
  return payload;
}

function formatTimestamp(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts?.toDate) return "—";
  return ts.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const emptyAddForm = { fullName: "", username: "", password: "", confirmPassword: "" };
const emptyPasswordForm = { password: "", confirmPassword: "" };

export default function FinanceUsersSettingsPage() {
  const { authenticated, loading, role } = requireAdmin();
  const canQuery = authenticated && role === "admin";

  const [users, setUsers] = useState<FinanceUserRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [addError, setAddError] = useState("");
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<FinanceUserRow | null>(null);
  const [editForm, setEditForm] = useState({ fullName: "", username: "" });
  const [editError, setEditError] = useState("");

  const [passwordTarget, setPasswordTarget] = useState<FinanceUserRow | null>(null);
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm);
  const [passwordError, setPasswordError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<FinanceUserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setFetching(true);
    setError("");
    try {
      const response = await firebaseAuthedFetch("/api/finance/users");
      const payload = await readJson(response);
      setUsers(payload.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Finance Users.");
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (!canQuery) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuery]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const visibleUsers = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    return users
      .filter((u) => {
        if (statusFilter === "active" && !u.active) return false;
        if (statusFilter === "disabled" && u.active) return false;
        if (searchLower && !u.fullName.toLowerCase().includes(searchLower) && !u.username.toLowerCase().includes(searchLower)) return false;
        return true;
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [users, search, statusFilter]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10 text-slate-900">Checking your session…</main>;
  }
  if (!authenticated || role !== "admin") return null;

  const openAddModal = () => {
    setAddForm(emptyAddForm);
    setAddError("");
    setAddModalOpen(true);
  };

  const handleAddSave = async () => {
    setAddError("");
    if (!addForm.fullName.trim()) {
      setAddError("Full name is required.");
      return;
    }
    if (!addForm.username.trim()) {
      setAddError("Username is required.");
      return;
    }
    if (!addForm.password) {
      setAddError("Password is required.");
      return;
    }
    if (addForm.password !== addForm.confirmPassword) {
      setAddError("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await readJson(
        await firebaseAuthedFetch("/api/finance/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(addForm),
        }),
      );
      setAddModalOpen(false);
      setToast("Finance user created.");
      await load();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create Finance User.");
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (user: FinanceUserRow) => {
    setEditing(user);
    setEditForm({ fullName: user.fullName, username: user.username });
    setEditError("");
  };

  const handleEditSave = async () => {
    if (!editing) return;
    setEditError("");
    if (!editForm.fullName.trim()) {
      setEditError("Full name is required.");
      return;
    }
    if (!editForm.username.trim()) {
      setEditError("Username is required.");
      return;
    }
    setSaving(true);
    try {
      await readJson(
        await firebaseAuthedFetch(`/api/finance/users/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: editForm.fullName, username: editForm.username }),
        }),
      );
      setEditing(null);
      setToast("Finance user updated.");
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update Finance User.");
    } finally {
      setSaving(false);
    }
  };

  const openPasswordModal = (user: FinanceUserRow) => {
    setPasswordTarget(user);
    setPasswordForm(emptyPasswordForm);
    setPasswordError("");
  };

  const handlePasswordSave = async () => {
    if (!passwordTarget) return;
    setPasswordError("");
    if (!passwordForm.password) {
      setPasswordError("New password is required.");
      return;
    }
    if (passwordForm.password !== passwordForm.confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await readJson(
        await firebaseAuthedFetch(`/api/finance/users/${passwordTarget.id}/password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(passwordForm),
        }),
      );
      setPasswordTarget(null);
      setToast("Password changed.");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (user: FinanceUserRow) => {
    setBusyId(user.id);
    setError("");
    try {
      await readJson(
        await firebaseAuthedFetch(`/api/finance/users/${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !user.active }),
        }),
      );
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, active: !u.active } : u)));
      setToast(user.active ? "Finance user disabled." : "Finance user enabled.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update Finance User.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    setError("");
    try {
      await readJson(await firebaseAuthedFetch(`/api/finance/users/${deleteTarget.id}`, { method: "DELETE" }));
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setToast("Finance user deleted.");
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete Finance User.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-orange-600">Finance · Settings</p>
          <h1 className="mt-1 text-3xl font-black">Finance Users</h1>
          <p className="mt-2 text-sm text-slate-600">
            Logins for the Daily Closing mobile app only — cashiers and managers. These accounts are completely separate from
            DAJAJ Admin logins and cannot access this web app.
          </p>
          <div className="mt-5">
            <FinanceNav />
          </div>
        </header>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap gap-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or username…"
              className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "disabled")}
                className="appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-9 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" strokeWidth={2.5} />
            </div>
          </div>
          <button type="button" onClick={openAddModal} className="flex items-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
            <Plus className="h-4 w-4" /> Add Finance User
          </button>
        </div>

        {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : null}

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {fetching ? (
            <p className="p-6 text-sm text-slate-500">Loading Finance Users…</p>
          ) : visibleUsers.length === 0 ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-400">No Finance Users found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Username</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last Login</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((u) => (
                    <tr key={u.id} className="border-b border-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-800">{u.fullName}</td>
                      <td className="px-4 py-3 text-slate-500">{u.username}</td>
                      <td className="px-4 py-3">
                        {u.active ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">Active</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">Disabled</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{u.lastLogin ? formatTimestamp(u.lastLogin) : "Never Logged In"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatTimestamp(u.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" onClick={() => openEditModal(u)} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => openPasswordModal(u)}
                            className="flex items-center gap-1 rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <KeyRound className="h-3.5 w-3.5" /> Change Password
                          </button>
                          <button
                            type="button"
                            disabled={busyId === u.id}
                            onClick={() => handleToggleActive(u)}
                            className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {u.active ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === u.id}
                            onClick={() => setDeleteTarget(u)}
                            className="rounded-xl border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {addModalOpen ? (
        <Modal title="Add Finance User" subtitle="For the Daily Closing mobile app only." onClose={() => setAddModalOpen(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Full Name</label>
              <input
                value={addForm.fullName}
                onChange={(e) => setAddForm((f) => ({ ...f, fullName: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Username</label>
              <input
                value={addForm.username}
                onChange={(e) => setAddForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="e.g. cashier1"
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Password</label>
              <input
                type="password"
                value={addForm.password}
                onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Confirm Password</label>
              <input
                type="password"
                value={addForm.confirmPassword}
                onChange={(e) => setAddForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            {addError ? <p className="text-sm font-medium text-rose-600">{addError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setAddModalOpen(false)} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={handleAddSave} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {editing ? (
        <Modal title="Edit Finance User" onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Full Name</label>
              <input
                value={editForm.fullName}
                onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Username</label>
              <input
                value={editForm.username}
                onChange={(e) => setEditForm((f) => ({ ...f, username: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <p className="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
              Passwords are never shown or editable here — use Change Password instead.
            </p>
            {editError ? <p className="text-sm font-medium text-rose-600">{editError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={handleEditSave} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {passwordTarget ? (
        <Modal title="Change Password" subtitle={`${passwordTarget.fullName} (${passwordTarget.username})`} onClose={() => setPasswordTarget(null)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">New Password</label>
              <input
                type="password"
                value={passwordForm.password}
                onChange={(e) => setPasswordForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Confirm Password</label>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </div>
            {passwordError ? <p className="text-sm font-medium text-rose-600">{passwordError}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPasswordTarget(null)} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" disabled={saving} onClick={handlePasswordSave} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal title="Delete Finance User?" onClose={() => setDeleteTarget(null)} maxWidthClassName="max-w-md">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              This will permanently delete <span className="font-semibold text-slate-900">{deleteTarget.fullName}</span> (
              {deleteTarget.username}). This cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="button"
                disabled={busyId === deleteTarget.id}
                onClick={handleDelete}
                className="rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {busyId === deleteTarget.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {toast ? (
        <div className="fixed left-1/2 top-5 z-[70] -translate-x-1/2">
          <div className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg">{toast}</div>
        </div>
      ) : null}
    </main>
  );
}
