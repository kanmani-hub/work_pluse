const fs = require('fs');
let content = fs.readFileSync('src/pages/admin/Offices.tsx', 'utf8');

const regex = /const results = await locationAutocomplete\.search\(val\.trim\(\), controller\.signal\);\s*setLocationSuggestions\(results\);\s*setLocationError\(''\);\s*\} catch \(err: any\) \{\s*if \(err\.name !== 'AbortError'\) \{\s*setLocationError\('Location search is temporarily unavailable\.'\);\s*\}\s*\} finally \{\s*setLocationLoading\(false\);\s*\}/;

const replaceWith = `const results = await locationAutocomplete.search(val.trim(), controller.signal);
                                  setLocationSuggestions(results);
                                  setLocationError('');
                                  setLocationLoading(false);
                                } catch (err: any) {
                                  if (err.name !== 'AbortError' && err.message !== 'Aborted') {
                                    setLocationError('Location search is temporarily unavailable.');
                                    setLocationLoading(false);
                                  }
                                }`;

content = content.replace(regex, replaceWith);
fs.writeFileSync('src/pages/admin/Offices.tsx', content);
