const db = require("./db.js");
require("dotenv").config();

db.dbServer.host = process.env.DB;
db.dbServer.user = process.env.DB_USER;
db.dbServer.password = process.env.DB_PASS;
db.ssh_config.password = process.env.SSH_PASS;
db.setQueryMode("ssh");

// const path = "C:\\Users\\South\\Downloads\\Joseph Albert & Elda Whiting Brown Family Contact List - Geraldine.csv";

async function login(username, password) {
    const response = await fetch('http://localhost:3000/auth', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': JSON.stringify({ username, password })
        }
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'Login failed');
    }
    return data.token;
}

async function apiCall(endpoint, token, options = {}) {
    const response = await fetch(`http://localhost:3000${endpoint}`, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            ...options.headers
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || 'API call failed');
    }
    return data;
}

async function main() {
    const token = await login('test', 'test');
    console.log('Logged in with token:', token);

    const roots = await apiCall('/getMyFamiliesRoots', token);
    console.log('Family Roots:', roots);

    const people = await apiCall('/people', token);
    console.log(`\nVisible People (${people.length - 1} total):`);
    // Skip header row, show first 10 names
    const names = people.slice(1, 11).map(p => p[2]);
    console.log(names);
    console.log('...');

    db.file.save('people.csv', people.map(row => row.join(',')).join('\n'));

    // Test new permissions endpoint
    const perms = await apiCall('/permissions', token);
    console.log('\nPermissions:', perms);
    console.log('Family Permissions:', perms.family_permissions);
}

async function testDescendants() {
    const token = await login('test', 'test');
    console.log('Logged in with token:', token);

    // Get all people to find Raymond Southwick's ID
    const people = await apiCall('/people', token);

    // Find Raymond Southwick (header is row 0, so skip it)
    const raymond = people.find(p => p[2] === 'Raymond Southwick');
    if (!raymond) {
        console.log('ERROR: Raymond Southwick not found!');
        return;
    }
    const raymondId = raymond[0];
    console.log(`\nFound Raymond Southwick with ID: ${raymondId}`);

    // Get descendants of Raymond Southwick
    const descendantIds = await apiCall(`/descendants/${raymondId}`, token);
    console.log(`\nDescendants of Raymond Southwick: ${descendantIds.length} people`);

    // Get full details of descendants
    const descendantNames = descendantIds.map(id => {
        const person = people.find(p => p[0] === id);
        return person ? person[2] : `Unknown (ID: ${id})`;
    });

    console.log('\nAll descendants and their spouses:');
    descendantNames.forEach(name => console.log(`  - ${name}`));

    // Check if Lauren Southwick is included
    const laurenIncluded = descendantNames.some(name => name.includes('Lauren'));
    console.log(`\n*** Lauren Southwick included: ${laurenIncluded ? 'YES ✓' : 'NO ✗'} ***`);

    // Also check for Matthias
    const matthiasIncluded = descendantNames.some(name => name.includes('Matthias'));
    console.log(`*** Matthias Southwick included: ${matthiasIncluded ? 'YES ✓' : 'NO ✗'} ***`);
}

// Run the descendants test
// testDescendants();
main();
