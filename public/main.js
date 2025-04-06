const $ = (q) => document.querySelector(q);
async function signin() {
  let data = await googleAuth();
  let token = await data.loginSuccess;
  main();
}

async function skipSignin() {
  let worked = await request("/hello2");
  if (!worked.error) {
    document.querySelector("#login").src = "autologin.png";
    main();
  }
}

async function main() {
  data = await request("/people");
  names = data
    .filter((e, i) => i > 0)
    .map((row) => {
      return { name: row[1] };
    });
  document.querySelector("load").classList.add("hidden");
  renderTable(names);
}

let names, data;

function gotoSearch() {
  $("search").classList.remove("out");
  $("#profile").classList.add("out");
  $("#search").value = "";
  renderTable();
}

function gotoProfile() {
  $("search").classList.add("out");
  $("#profile").classList.remove("out");
}

function handleClick(name) {
  gotoProfile();
  let p = data.filter((e) => e[1] == name)[0];
  $("#name").innerHTML = p[1];
  $("#address").innerHTML = p[2];
  $("#phone").innerHTML = p[3];
  $("#email").innerHTML = p[4];
  $("#age").innerHTML = p[6]
    ? "Age: " + Math.floor((new Date() - new Date(p[6])) / 31536000000)
    : "Brirthday not found";
}

function renderTable() {
  const table = document.getElementById("table");
  const searchTerm = document.getElementById("search").value.toLowerCase();

  // Clear current table
  table.innerHTML = "";

  // Add header
  const header = document.createElement("div");
  header.className = "row header";
  header.innerHTML = `<div class="cell">Name</div>`;

  // table.appendChild(header);

  // Filtered rows
  const filteredData = !searchTerm
    ? names
    : names.filter((item) => item.name.toLowerCase().includes(searchTerm));

  filteredData.forEach((item) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div class="cell">${item.name}</div>`;
    row.onclick = () => handleClick(item.name);
    table.appendChild(row);
  });
}

// main();
skipSignin();
