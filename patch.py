import sys

# Read the file directly
with open('src/app/[userId]/page.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# Fix 1: Theme initialization
old = '    setIsDark(document.documentElement.classList.contains("dark"));'
new = '''    const savedTheme = localStorage.getItem("caloriq-theme");
    if (savedTheme === "dark") {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("caloriq-theme", "light");
      setIsDark(false);
    }'''

if old in c:
    c = c.replace(old, new)
    print("Theme fix applied")
else:
    print("WARNING: theme pattern not found - already patched or different version")

print("caloriq-theme refs:", c.count("caloriq-theme"))

with open('src/app/[userId]/page.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

# Fix 2: Privacy page
with open('src/app/privacy/page.tsx', 'r', encoding='utf-8') as f:
    p = f.read()

p = p.replace(
    '<a href="mailto:lkaspary@gmail.com" className="text-blue-500 underline">lkaspary@gmail.com</a>',
    '<a href="/account" className="text-blue-500 underline">in-app feedback form</a>'
)
p = p.replace('📧', '💬')

remaining = p.count('lkaspary@gmail.com')
print("Privacy emails remaining:", remaining)

with open('src/app/privacy/page.tsx', 'w', encoding='utf-8') as f:
    f.write(p)

print("All done!")
