export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center px-6 py-16">
      <div className="max-w-xl w-full">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">About Caloriq</h1>
        <p className="text-gray-600 dark:text-gray-400 leading-relaxed text-base">
          I built Calor-iq because I wanted to own my health data and use AI to do what used to require
          expensive professionals. AI became my nutritionist and coach — I describe what I ate, and it
          figures out the rest. I use the export function to share my logs with my actual care team and
          adapt my diet to my own conditions. The belief behind Calor-iq is simple: this kind of
          intelligent, personal nutrition tracking should be accessible to everyone, not just those who
          can afford a premium platform or a dedicated coach. I&apos;m on a journey to build a better
          life, and I built the tool I wished existed along the way.
        </p>
        <a
          href="/"
          className="inline-block mt-8 text-sm text-emerald-600 dark:text-emerald-400 hover:underline"
        >
          ← Back to app
        </a>
      </div>
    </main>
  );
}