with open('tailwind.config.ts', 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace('  theme:', '  darkMode: "class",\n  theme:')

with open('tailwind.config.ts', 'w', encoding='utf-8') as f:
    f.write(c)

print('Done. New content:')
print(c)
