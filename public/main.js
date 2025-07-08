const $ = (q) => document.querySelector(q);
let permissions;
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
  permissions = await request("/permissions");
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

function hideAll() {
  let elements = document.querySelectorAll(".main");
  for (let e of elements) {
    e.classList.add("out");
  }
}

function gotoSearch() {
  hideAll();
  $("search").classList.remove("out");
  $("#search").value = "";
  renderTable();
}

function gotoProfile() {
  hideAll();
  $("#profile").classList.remove("out");
}

function gotoCalendar() {
  hideAll();
  $("#calendar").classList.remove("out");
  populateCalendarMonth();
}

async function handleClick(name) {
  let submitBtn = $("#submit-btn");
  let editBtn = $("#edit-btn");
  submitBtn.style.display = 'none';
  editBtn.style.display = 'none';
  let profile = await request("/people/" + encodeURI(name));
  gotoProfile();
  let p = data.filter((e) => e[2] == name)[0];
  $("#name").innerHTML = profile[0].name;
  $("#address").innerHTML = profile[0].address;
  $("#phone").innerHTML = profile[0].phone;
  $("#email").innerHTML = profile[0].email;
  let birth_date = profile[0].birthday;
  $("#bday").innerHTML = new Date(profile[0].birthday).toLocaleDateString(
    "en-us",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    }
  );
  $("#age").innerHTML = birth_date
    ? Math.floor((new Date() - new Date(birth_date)) / 31536000000)
    : "Brirthday not found";

  $("#dday").innerHTML =
    profile.death_date == null
      ? ""
      : new Date(profile[0].death_date).toLocaleDateString("en-us", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

  if (permissions && permissions.role === "admin") {
    // Add Edit button
    editBtn.style.display = "inherit";

    editBtn.onclick = function () {
      // Replace fields with input elements (except age)
      const fields = [
        { id: "name", value: profile[0].name },
        { id: "address", value: profile[0].address },
        { id: "phone", value: profile[0].phone },
        { id: "email", value: profile[0].email },
        { id: "bday", value: profile[0].birthday },
        { id: "dday", value: profile[0].death_date || "" },
      ];
      fields.forEach((f) => {
        let el = $("#" + f.id);
        let input = document.createElement("input");
        input.type = f.id === "bday" || f.id === "dday" ? "date" : "text";
        // Set value for date inputs in yyyy-mm-dd format
        if ((f.id === "bday" || f.id === "dday") && f.value) {
          // Ensure only yyyy-mm-dd part is used
          input.value = f.value.slice(0, 10);
        } else {
          input.value = f.value || "";
        }
        input.id = f.id + "-input";
        el.innerHTML = "";
        el.appendChild(input);
      });

      // Show submit button
      submitBtn.style.display = "inherit";

      submitBtn.onclick = async function () {
        // Gather updated values
        const updated = {
          name: $("#name-input").value,
          address: $("#address-input").value,
          phone: $("#phone-input").value,
          email: $("#email-input").value,
          birthday: $("#bday-input").value,
          death_date: $("#dday-input").value,
        };
        // POST updated data
        await request(`/people/${encodeURIComponent(profile[0].name)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        });
        // Optionally, reload profile
        handleClick(updated.name);
      };
      // Hide edit button after entering edit mode
      editBtn.style.display = "none";
    };
  }
}

function populateCalendarMonth(m = month) {
  let birthdays_this_month = data
    .filter((e) => e[7])
    .filter((e) => new Date(e[7]).getMonth() == m);
  let first_day_of_month = new Date();
  first_day_of_month.setMonth(m);
  first_day_of_month.setDate(1);
  let last_day_of_month = new Date(first_day_of_month);
  last_day_of_month.setMonth(last_day_of_month.getMonth() + 1);
  last_day_of_month.setDate(0);
  $("#monthlabel").innerHTML = first_day_of_month.toLocaleDateString("en-us", {
    month: "long",
  });
  $("#month").innerHTML = "";
  let counter = 0,
    d;
  for (let row = 0; row < 6; row++) {
    for (let day = 0; day < 7; day++) {
      let box = document.createElement("div");
      box.classList.add("day");
      d = ++counter - first_day_of_month.getDay();
      if (d > last_day_of_month.getDate()) d = -1;
      box.innerHTML += d >= 1 ? d : "";
      let bdays_today = birthdays_this_month.filter(
        (e) => new Date(e[7]).getDate() == d
      );
      for (let bday of bdays_today) {
        box.innerHTML += "<hr>" + bday[2];
      }
      $("#month").appendChild(box);
    }
    if (d == -1) {
      break;
    }
  }
}

function nextMonth() {
  month = (month + 1 + 12) % 12;
  populateCalendarMonth();
}

function prevMonth() {
  month = (month - 1 + 12) % 12;
  populateCalendarMonth();
}

let month = new Date().getMonth();

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
