import re

# Read the file
with open('src/pages/Designer.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace box-drawing characters
content = re.sub(r'â•"[â•═]+â•—', '================================================', content)
content = re.sub(r'â• [â•═]+â•£', '||===============================================', content)
content = re.sub(r'â•š[â•═]+â•', '================================================', content)
content = re.sub(r'â•â•â• ', '=== ', content)
content = re.sub(r' â•â•â•', ' ===', content)
content = re.sub(r'â•' ', '|| ', content)
content = re.sub(r' â•'', '', content)

# Replace emojis
replacements = {
    'ðŸ"': '[NOTE]',
    'ðŸ"„': '[SYNC]',
    'ðŸ§ª': '[TEST]',
    'ðŸ"¡': '[API]',
    'ðŸ"¥': '[DATA]',
    'âŒ': '[ERROR]',
    'âœ…': '[OK]',
    'âœ"': '[OK]',
    'ðŸ"§': '[CONFIG]',
    'â­ï¸': '[SKIP]',
    'ðŸ—'ï¸': '[DELETE]',
    'ðŸ"': '[SEARCH]',
    'âš ï¸': '[WARN]',
    'ðŸ"´': '[DEBUG]',
    'ðŸ"': '[DEBUG]',
    'ðŸ'': '[SUCCESS]',
    'ðŸ"Š': '[STATS]'
}

for old, new in replacements.items():
    content = content.replace(old, new)

# Write back
with open('src/pages/Designer.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed corrupted characters in Designer.jsx")
