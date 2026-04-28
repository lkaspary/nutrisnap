"use client";

const EFFECTIVE_DATE = "April 27, 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 px-4 py-12">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="text-center mb-10">
          <img src="/icons/icon-192.png" alt="Caloriq" className="w-16 h-16 rounded-2xl mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-1">Privacy Policy</h1>
          <p className="text-gray-500 text-sm">Caloriq · calor-iq.com</p>
          <p className="text-gray-400 text-xs mt-1">Effective Date: {EFFECTIVE_DATE}</p>
        </div>

        <div className="space-y-8 text-sm text-gray-700 dark:text-gray-300">

          <section>
            <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">1. Introduction</h2>
            <p className="mb-3">Caloriq ("we", "our", or "us") is an AI-powered calorie and macro tracking application available at calor-iq.com and on the Google Play Store. We are committed to protecting your privacy and handling your personal data transparently and responsibly.</p>
            <p>This Privacy Policy explains what data we collect, how we use it, how we protect it, and your rights regarding your data.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">2. Data We Collect</h2>

            <h3 className="font-semibold mb-2 text-gray-800 dark:text-gray-200">Personal Information</h3>
            <ul className="list-disc ml-5 space-y-1 mb-4">
              <li>Name — collected via Google Sign-In</li>
              <li>Email address — collected via Google Sign-In</li>
              <li>Profile photo — collected via Google Sign-In (optional)</li>
            </ul>

            <h3 className="font-semibold mb-2 text-gray-800 dark:text-gray-200">Health & Fitness Information</h3>
            <ul className="list-disc ml-5 space-y-1 mb-4">
              <li>Nutrition data — meals, calories, protein, carbohydrates, and fat you log</li>
              <li>Body stats — weight, height, age, and gender (optional, provided by you)</li>
            </ul>

            <h3 className="font-semibold mb-2 text-gray-800 dark:text-gray-200">Photos</h3>
            <ul className="list-disc ml-5 space-y-1 mb-4">
              <li>Meal photos and nutrition label images uploaded for AI analysis</li>
              <li>Photos are processed ephemerally for AI analysis and are not permanently stored on our servers</li>
            </ul>

            <h3 className="font-semibold mb-2 text-gray-800 dark:text-gray-200">App Activity</h3>
            <ul className="list-disc ml-5 space-y-1 mb-4">
              <li>Daily AI analysis usage count — to enforce free tier limits</li>
              <li>Day confirmation status — when you confirm all meals have been logged</li>
            </ul>

            <h3 className="font-semibold mb-2 text-gray-800 dark:text-gray-200">Payment Information</h3>
            <p>We do not collect or store payment card information. All payments are processed by Stripe, Inc. Stripe may receive your email address and name for billing purposes. Please review <a href="https://stripe.com/privacy" className="text-blue-500 underline" target="_blank" rel="noopener noreferrer">Stripe's Privacy Policy</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">3. How We Use Your Data</h2>
            <ul className="list-disc ml-5 space-y-1">
              <li>To provide core app functionality — logging meals, tracking nutrition, and displaying progress</li>
              <li>To personalize your experience — calculating calorie and protein goals based on your body stats</li>
              <li>To enforce usage limits — tracking daily AI analyses for free tier users</li>
              <li>To process payments — managing Pro subscriptions through Stripe</li>
              <li>To improve the app — understanding how users interact with features</li>
              <li>To communicate with you — responding to feedback and support requests</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">4. Data Sharing and Third Parties</h2>
            <p className="mb-4">We do not sell your personal data. We share data only with the following trusted third parties:</p>

            <div className="space-y-4">
              <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-4">
                <p className="font-semibold mb-1">Anthropic (Claude AI)</p>
                <p className="text-gray-500 dark:text-gray-400">Meal photos, nutrition label images, and food descriptions are sent to Anthropic's API for AI analysis, in accordance with <a href="https://anthropic.com/privacy" className="text-blue-500 underline" target="_blank" rel="noopener noreferrer">Anthropic's Privacy Policy</a>.</p>
              </div>
              <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-4">
                <p className="font-semibold mb-1">Stripe</p>
                <p className="text-gray-500 dark:text-gray-400">Name and email address are shared with Stripe for subscription billing and payment processing.</p>
              </div>
              <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-4">
                <p className="font-semibold mb-1">Supabase</p>
                <p className="text-gray-500 dark:text-gray-400">Your data is stored in Supabase's database infrastructure. Supabase is SOC 2 compliant and stores data securely on AWS infrastructure.</p>
              </div>
              <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-4">
                <p className="font-semibold mb-1">Vercel</p>
                <p className="text-gray-500 dark:text-gray-400">Our application is hosted on Vercel's platform, in accordance with <a href="https://vercel.com/legal/privacy-policy" className="text-blue-500 underline" target="_blank" rel="noopener noreferrer">Vercel's Privacy Policy</a>.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">5. Data Retention</h2>
            <p>We retain your data for as long as your account is active. If you delete your account, all your personal data — including your profile, meal history, and body stats — is permanently deleted from our systems within 30 days.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">6. Data Security</h2>
            <p className="mb-3">All data transmitted between your device and our servers is encrypted using HTTPS/TLS. Your data is stored in Supabase's secure database infrastructure. We use industry-standard security practices to protect your information.</p>
            <p>While we take reasonable steps to protect your data, no method of transmission over the internet is 100% secure.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">7. Your Rights</h2>
            <p className="mb-3">You have the following rights regarding your personal data:</p>
            <ul className="list-disc ml-5 space-y-1 mb-4">
              <li><strong>Access</strong> — request a copy of the data we hold about you</li>
              <li><strong>Correction</strong> — update or correct inaccurate data via app settings</li>
              <li><strong>Deletion</strong> — permanently delete all your data and close your account</li>
              <li><strong>Export</strong> — download your complete food log as a CSV file at any time</li>
              <li><strong>Cancellation</strong> — cancel your Pro subscription at any time via the billing portal</li>
            </ul>
            <p>To exercise any of these rights, visit <a href="/account" className="text-blue-500 underline">calor-iq.com/account</a> or contact us at <a href="mailto:lkaspary@gmail.com" className="text-blue-500 underline">lkaspary@gmail.com</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">8. Children's Privacy</h2>
            <p>Caloriq is not intended for children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe we have inadvertently collected such information, please contact us immediately.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">9. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify you of significant changes by updating the effective date at the top of this policy. Continued use of the app after changes constitutes acceptance of the updated policy.</p>
          </section>

          <section>
            <h2 className="text-lg font-bold mb-3 text-gray-900 dark:text-white">10. Contact Us</h2>
            <p className="mb-3">If you have questions, concerns, or requests regarding this Privacy Policy or your data, please contact us:</p>
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl p-4 space-y-1">
              <p>📧 <a href="mailto:lkaspary@gmail.com" className="text-blue-500 underline">lkaspary@gmail.com</a></p>
              <p>🌐 <a href="/account" className="text-blue-500 underline">calor-iq.com/account</a></p>
            </div>
          </section>

        </div>

        <p className="text-center text-xs text-gray-400 mt-12">Last updated: {EFFECTIVE_DATE}</p>

      </div>
    </div>
  );
}