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
      return { name: row[2] };
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

async function handleClick(name) {
  gotoProfile();
  let profile = await request("/people/" + encodeURI(name));
  let p = data.filter((e) => e[2] == name)[0];
  $("#name").innerHTML = profile[0].name;
  $("#address").innerHTML = profile[0].address;
  $("#phone").innerHTML = profile[0].phone;
  $("#email").innerHTML = profile[0].email;
  let birth_date = profile[0].birthday;
  $("#age").innerHTML = birth_date
    ? "Age: " + Math.floor((new Date() - new Date(birth_date)) / 31536000000)
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

window.addEventListener("popstate", function (event) {
  // Prevent default back button behavior
  event.preventDefault();

  // Call your custom function
  gotoSearch();
});

// main();
skipSignin();
