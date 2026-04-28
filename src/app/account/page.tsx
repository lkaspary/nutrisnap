"use client";
import { useState } from "react";

export default function AccountPage() {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"idle" | "confirm_delete" | "deleting" | "deleted" | "error">("idle");
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleDelete = async () => {
    if (!email.trim()) return;
    setDeleting(true);
    setStep("deleting");
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      }).then(r => r.json());

      if (res.success) {
        setStep("deleted");
      } else {
        setErrorMsg(res.error ?? "Something went wrong. Please try again.");
        setStep("error");
      }
    } catch {
      setErrorMsg("Could not connect. Please try again.");
      setStep("error");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex items-start justify-center px-4 py-12">
      <div className="max-w-md w-full">

        {/* Header */}
        <div className="text-center mb-8">
          <img src="/icons/icon-192.png" alt="Caloriq" className="w-16 h-16 rounded-2xl mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Manage your account</h1>
          <p className="text-gray-500 text-sm mt-1">calor-iq.com</p>
        </div>

        {step === "deleted" ? (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-6 text-center">
            <div className="text-4xl mb-3">✅</div>
            <h2 className="text-lg font-semibold mb-2">Account deleted</h2>
            <p className="text-sm text-gray-500">All your data has been permanently deleted from our systems. This cannot be undone.</p>
            <p className="text-xs text-gray-400 mt-4">If you had an active subscription, please allow up to 24 hours for the cancellation to fully process with Stripe.</p>
          </div>
        ) : step === "error" ? (
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-6 text-center">
            <div className="text-4xl mb-3">⚠️</div>
            <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-500 mb-4">{errorMsg}</p>
            <button onClick={() => { setStep("idle"); setErrorMsg(""); }}
              className="text-sm text-blue-500 hover:text-blue-700">Try again</button>
          </div>
        ) : (
          <>
            {/* Cancel subscription */}
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-5 mb-4">
              <div className="flex items-start gap-3 mb-4">
                <span className="text-2xl">💳</span>
                <div>
                  <h2 className="text-sm font-semibold">Cancel subscription</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Manage or cancel your Pro subscription. You'll keep access until the end of your billing period.</p>
                </div>
              </div>
              <a href="https://billing.stripe.com/p/login/14A6oA8ILaui26P8Zu3ks00"
                target="_blank" rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-200 dark:border-zinc-600 text-sm font-medium hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                Open billing portal →
              </a>
            </div>

            {/* Delete account */}
            <div className="bg-white dark:bg-zinc-900 border border-red-100 dark:border-red-900/30 rounded-2xl p-5">
              <div className="flex items-start gap-3 mb-4">
                <span className="text-2xl">🗑️</span>
                <div>
                  <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">Delete my data</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Permanently delete all your meals, profile, and account data. This cannot be undone.</p>
                </div>
              </div>

              {step === "confirm_delete" ? (
                <div className="space-y-3">
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                    This will permanently delete:
                  </p>
                  <ul className="text-xs text-gray-500 space-y-1 ml-3">
                    <li>• Your profile and all personal information</li>
                    <li>• All meal logs and nutrition history</li>
                    <li>• All account data from our systems</li>
                  </ul>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setStep("idle")}
                      className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2.5 text-sm text-gray-400">
                      Cancel
                    </button>
                    <button onClick={handleDelete} disabled={deleting}
                      className="flex-[2] bg-red-500 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-red-600 disabled:opacity-40">
                      {deleting ? "Deleting…" : "Yes, delete everything"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Enter your email address"
                    className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2.5 text-sm bg-transparent outline-none focus:border-red-300"
                  />
                  <button
                    onClick={() => setStep("confirm_delete")}
                    disabled={!email.trim() || !email.includes("@")}
                    className="w-full py-2.5 rounded-xl border border-red-200 dark:border-red-900/50 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40">
                    Request account deletion
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <p className="text-center text-xs text-gray-400 mt-6">
              Questions? Contact us at{" "}
              <a href="mailto:lkaspary@gmail.com" className="underline">support@calor-iq.com</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}