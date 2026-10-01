const fs = require('fs');
const txt = fs.readFileSync('test_html_out.txt', 'utf16le');
console.log('Has 1:', txt.includes('>1</div><div class="sc-title">Total Employees'));
console.log('Has 0:', txt.includes('>0</div><div class="sc-title">Total Employees'));
