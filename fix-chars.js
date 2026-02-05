const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'pages', 'Designer.jsx');

// Read the file
let content = fs.readFileSync(filePath, 'utf8');

// Count initial occurrences
const initialCorrupted = (content.match(/[â]/g) || []).length + (content.match(/[ðŸ]/g) || []).length;
console.log(`Initial corrupted characters found: ${initialCorrupted}`);

// Define all replacements - use regex for better matching
const replacements = [
  // Box drawing patterns - match the actual corrupted sequences
  [/â•"[â•â•—]+/g, (match) => '='.repeat(match.length > 60 ? 64 : 48)],
  [/â•š[â•]+/g, (match) => '='.repeat(match.length > 60 ? 64 : 48)],
  [/â• [â•£]+/g, (match) => '||' + '='.repeat(match.length > 60 ? 63 : 47)],
  [/â•[â•]+/g, (match) => {
    // Check if it's a title pattern
    if (content.substring(content.indexOf(match) - 10, content.indexOf(match) + match.length + 10).includes('DESIGNER STATE')) {
      return '===';
    }
    if (content.substring(content.indexOf(match) - 10, content.indexOf(match) + match.length + 10).includes('LOADING PRINT AREAS')) {
      return '===';
    }
    if (content.substring(content.indexOf(match) - 10, content.indexOf(match) + match.length + 10).includes('CANVAS DIMENSIONS')) {
      return '===';
    }
    if (content.substring(content.indexOf(match) - 10, content.indexOf(match) + match.length + 10).includes('FABRIC CANVAS EXPORT')) {
      return '===';
    }
    if (content.substring(content.indexOf(match) - 10, content.indexOf(match) + match.length + 10).includes('RENDER EFFECT TRIGGERED')) {
      return '===';
    }
    if (content.substring(content.indexOf(match) - 10, content.indexOf(match) + match.length + 10).includes('PRINT LOCATION DEBUG')) {
      return '===';
    }
    return '='.repeat(match.length > 40 ? (match.length > 60 ? 64 : 48) : match.length);
  }],
  [/â•'/g, '||'],

  // Emoji replacements
  [/ðŸ"/g, '[NOTE]'],
  [/ðŸ"„/g, '[SYNC]'],
  [/ðŸ§ª/g, '[TEST]'],
  [/ðŸ"¡/g, '[API]'],
  [/ðŸ"¥/g, '[DATA]'],
  [/âŒ/g, '[ERROR]'],
  [/âœ…/g, '[OK]'],
  [/âœ"/g, '[OK]'],
  [/ðŸ"§/g, '[CONFIG]'],
  [/â­ï¸/g, '[SKIP]'],
  [/ðŸ—'ï¸/g, '[DELETE]'],
  [/ðŸ"/g, '[SEARCH]'],
  [/âš ï¸/g, '[WARN]'],
  [/ðŸ"´/g, '[DEBUG]'],
  [/ðŸŽ‰/g, '[CELEBRATE]'],
  [/ðŸŽ¯/g, '[TARGET]'],
  [/ðŸŽŠ/g, '[COMPLETE]'],
  [/ðŸ'•/g, '[APPAREL]'],
  [/ðŸŽ¨/g, '[COLOR]'],
  [/ðŸ"¦/g, '[PACKAGE]'],
  [/ðŸš€/g, '[LAUNCH]'],
  [/ðŸŽ¬/g, '[ACTION]'],
  [/ðŸ"µ/g, '[INFO]'],
  [/âœ¨/g, '[SPARKLE]'],
  [/ðŸ'¡/g, '[TIP]'],
  [/ðŸ›/g, '[BUG]'],
  [/â‰¤/g, '<='],
];

// Apply all replacements
replacements.forEach(([pattern, replacement]) => {
  content = content.replace(pattern, replacement);
});

// Write the file back
fs.writeFileSync(filePath, content, 'utf8');

// Count remaining occurrences
const remaining = (content.match(/[â]/g) || []).length + (content.match(/[ðŸ]/g) || []).length;
console.log(`Remaining corrupted characters: ${remaining}`);
console.log('File fixed successfully!');
