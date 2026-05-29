# Read layout.tsx
with open('src/app/layout.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# Replace the service worker registration with one that unregisters old SWs and clears cache
old = """        <script dangerouslySetInnerHTML={{__html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js');
            });
          }
        `}} />"""

new = """        <script dangerouslySetInnerHTML={{__html: `
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
              regs.forEach(function(reg) { reg.unregister(); });
            });
            caches.keys().then(function(keys) {
              keys.forEach(function(key) { caches.delete(key); });
            });
          }
        `}} />"""

if old in c:
    c = c.replace(old, new)
    print("SW unregister patch applied")
else:
    print("WARNING: pattern not found, trying alternative...")
    # Just append the cache clearing before </body>
    c = c.replace('      </body>', """      <script dangerouslySetInnerHTML={{__html: `
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(reg){reg.unregister();});});
            caches.keys().then(function(k){k.forEach(function(key){caches.delete(key);});});
          }
        `}} />
      </body>""")
    print("Alternative patch applied")

with open('src/app/layout.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print("Done")
