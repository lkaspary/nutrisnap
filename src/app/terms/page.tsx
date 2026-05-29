"use client";

export default function TermsPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 text-gray-700 dark:text-gray-300">
      <div className="mb-10">
        <a href="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">← Back to Calor-IQ</a>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Terms of Service</h1>
      <p className="text-sm text-gray-400 mb-10">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

      <div className="space-y-8 text-sm leading-relaxed">

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">1. Who we are</h2>
          <p>Calor-IQ is a nutrition tracking app that uses artificial intelligence to help you log meals, understand your macros, and build healthier habits. By using Calor-IQ, you agree to these Terms of Service. If you do not agree, please do not use the app.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">2. What Calor-IQ is — and isn't</h2>
          <p>Calor-IQ is a personal wellness tool, not a medical product. The nutritional estimates, AI-generated insights, and calorie goals provided by Calor-IQ are for informational and educational purposes only. They are not medical advice, diagnoses, or treatment recommendations.</p>
          <p className="mt-2">Always consult a qualified healthcare professional before making significant changes to your diet, especially if you have a medical condition, eating disorder, or are pregnant or breastfeeding.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">3. Your account</h2>
          <p>You must be at least 13 years old to use Calor-IQ. By creating an account, you confirm that the information you provide is accurate. You are responsible for keeping your login credentials secure and for all activity under your account.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">4. AI-generated content</h2>
          <p>Calor-IQ uses AI models to estimate nutritional content from photos, text descriptions, and nutrition labels. These estimates are approximations — they may not be perfectly accurate and should not be relied upon for medical or clinical purposes. We make no guarantee about the accuracy of any nutritional data returned by the AI.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">5. Subscriptions and payments</h2>
          <p>Calor-IQ offers a free tier with a daily limit on AI analyses, and a Pro subscription for unlimited access. Payments are processed securely by Stripe. By subscribing, you authorize us to charge your payment method on a recurring basis (monthly or annually, depending on your plan).</p>
          <p className="mt-2">You may cancel your subscription at any time from within the app or through the Stripe customer portal. Cancellations take effect at the end of the current billing period. We do not offer refunds for partial billing periods unless required by applicable law.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">6. Your data</h2>
          <p>You own your data. We store your meal logs, body stats, and usage data to provide the service. We do not sell your personal data to third parties. You can export your full food log at any time from the History tab, and you can request deletion of your account and data by contacting us through the in-app feedback form.</p>
          <p className="mt-2">For full details on how we handle your data, please read our <a href="/privacy" className="text-indigo-500 hover:text-indigo-600 underline">Privacy Policy</a>.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">7. Acceptable use</h2>
          <p>You agree not to misuse Calor-IQ. This includes attempting to reverse-engineer the app, circumvent usage limits through automated means, upload harmful or illegal content, or use the service in any way that violates applicable laws.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">8. Service availability</h2>
          <p>We aim to keep Calor-IQ running reliably, but we do not guarantee uninterrupted access. We may update, modify, or temporarily suspend the service for maintenance or improvements. We are not liable for any loss resulting from downtime or service changes.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">9. Limitation of liability</h2>
          <p>To the fullest extent permitted by law, Calor-IQ and its creators are not liable for any indirect, incidental, or consequential damages arising from your use of the app — including but not limited to health outcomes, data loss, or decisions made based on AI-generated nutritional estimates.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">10. Changes to these terms</h2>
          <p>We may update these Terms from time to time. When we do, we'll update the date at the top of this page. Continued use of Calor-IQ after changes are posted constitutes acceptance of the updated terms.</p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-2">11. Contact</h2>
          <p>If you have questions about these Terms, please reach out through the feedback form inside the app. We read every message.</p>
        </section>

      </div>

      <div className="mt-12 pt-8 border-t border-gray-100 dark:border-zinc-800 flex gap-6 text-xs text-gray-400">
        <a href="/privacy" className="hover:text-gray-600 transition-colors">Privacy Policy</a>
        <a href="/" className="hover:text-gray-600 transition-colors">Back to app</a>
      </div>
    </div>
  );
}