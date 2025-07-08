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
  all_people = await request("/people");
  names = all_people
    .filter((e, i) => i > 0)
    .map((row) => {
      return { name: row[2] };
    });
  document.querySelector("load").classList.add("hidden");
  renderTable(names);
}

let names, all_people;

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
  let cancelBtn = $("#cancel-btn");
  submitBtn.style.display = "none";
  editBtn.style.display = "none";
  cancelBtn.style.display = "none";
  let profile_list = await request("/people/" + encodeURI(name));
  let profile = profile_list[0];
  gotoProfile();
  $("#name").innerHTML = profile.name;
  $("#address").innerHTML = profile.address;
  $("#phone").innerHTML = profile.phone;
  $("#email").innerHTML = profile.email;
  let birth_date = profile.birthday;
  $("#bday").innerHTML = new Date(profile.birthday).toLocaleDateString(
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
      : new Date(profile.death_date).toLocaleDateString("en-us", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
  let parents = $("#parents");
  parents.innerHTML = "";
  if (profile.father_name) {
    parents.appendChild(makeClickablePersonTag(profile.father_name));
  }
  if (profile.mother_name) {
    parents.appendChild(makeClickablePersonTag(profile.mother_name));
  }
  let children = $("#children");
  children.innerHTML = "";
  if (profile.children_names != null && profile.children_names != "") {
    for (let name of profile.children_names.split(",")) {
      children.appendChild(makeClickablePersonTag(name));
    }
  }
  let spouse = $("#spouse");
  spouse.innerHTML = "";
  if (profile.spouse_names != null && profile.spouse_names != "") {
    for (let name of profile.spouse_names.split(",")) {
      spouse.appendChild(makeClickablePersonTag(name));
    }
  }

  addEditButton(profile);
}

function addEditButton(profile) {
  if (permissions && permissions.role === "admin") {
    let submitBtn = $("#submit-btn");
    let editBtn = $("#edit-btn");
    let cancelBtn = $("#cancel-btn");

    
    let genderField = $("#gender");
    if (profile.gender == null || profile.gender === "") {
      genderField.innerHTML = "Not selected";
    } else {
      genderField.innerHTML = profile.gender === "Male" ? "Male" : "Female";
    }

    editBtn.style.display = "inherit";

    editBtn.onclick = function () {
      // Replace fields with input elements (except age)
      const fields = [
        { id: "name", value: profile.name },
        { id: "address", value: profile.address },
        { id: "phone", value: profile.phone },
        { id: "email", value: profile.email },
        { id: "bday", value: profile.birthday },
        { id: "dday", value: profile.death_date || "" },
        { id: "gender", value: profile.gender || "" },
      ];
      fields.forEach((f) => {
        let el = $("#" + f.id);
        let input = document.createElement("input");
        input.type = f.id === "bday" || f.id === "dday" ? "date" : "text";
        // Set value for date inputs in yyyy-mm-dd format
        if ((f.id === "bday" || f.id === "dday") && f.value) {
          input.value = f.value.slice(0, 10);
        } else {
          input.value = f.value || "";
        }
        input.id = f.id + "-input";
        el.innerHTML = "";
        el.appendChild(input);
      });

      // Editable person-tag lists for parents, children, spouse
      const relFields = [
        {
          id: "parents",
          names: [profile.father_name, profile.mother_name].filter(Boolean),
          key: "parents",
        },
        {
          id: "children",
          names: (profile.children_names || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          key: "children",
        },
        {
          id: "spouse",
          names: (profile.spouse_names || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          key: "spouse",
        },
      ];

      relFields.forEach((rel) => {
        const container = $("#" + rel.id);
        container.innerHTML = "";

        // Helper to render tags
        function renderTags(names) {
          container.innerHTML = "";
          names.forEach((name, idx) => {
            let tag = document.createElement("span");
            tag.classList.add("person-tag", "editable-tag");
            tag.innerHTML =
              name +
              ' <span class="remove-tag" style="color:red;cursor:pointer;">&times;</span>';
            tag.querySelector(".remove-tag").onclick = (e) => {
              e.stopPropagation();
              names.splice(idx, 1);
              renderTags(names);
            };
            container.appendChild(tag);
          });
          addPlusButton();
        }

        // Initial render
        renderTags(rel.names);

        // Add "+" button
        function addPlusButton() {
          let addBtn = document.createElement("button");
          addBtn.type = "button";
          addBtn.textContent = "+";
          addBtn.className = "add-person-btn";
          addBtn.onclick = async () => {
            let personName = await personSelectModal();
            if (!personName) return;
            // Only add if exists in names list and not already present
            if (
              names.some((n) => n.name === personName) &&
              !rel.names.includes(personName)
            ) {
              rel.names.push(personName);
              renderTags(rel.names);
            } else {
              alert("Person not found or already added.");
            }
          };
          container.appendChild(addBtn);
        }

        // Store back for submit
        rel.getNames = () => rel.names.slice();
      });

      // Show submit button
      submitBtn.style.display = "inherit";
      cancelBtn.style.display = "inherit";
      editBtn.style.display = "none";

      submitBtn.onclick = async function () {
        // Gather updated values
        const updated = {
          name: $("#name-input").value,
          address: $("#address-input").value,
          phone: $("#phone-input").value,
          email: $("#email-input").value,
          birthday: $("#bday-input").value,
          death_date: $("#dday-input").value,
          gender: (() => {
            const genderInput = $("#gender-input");
            if (!genderInput || !genderInput.value || genderInput.value === "Not selected") {
              return "";
            }
            const val = genderInput.value.toLowerCase();
            return val.includes("f") ? "Female" : "Male";
          })(),
          // Relationships
          father_name: relFields[0].getNames()[0] || "",
          mother_name: relFields[0].getNames()[1] || "",
          // children_names: relFields[1].getNames().join(","),
          spouse_names: relFields[2].getNames().join(","),
        };
        // POST updated data
        await request(`/people/${encodeURIComponent(profile.name)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated),
        });
        // Optionally, reload profile
        handleClick(updated.name);
      };

      cancelBtn.onclick = function () {
        handleClick(profile.name); // Reload profile without changes
      };
    };
  }
}

function personSelectModal() {
  return new Promise((resolve, reject) => {
    let modal = $("#person_select_modal");
    if (!personSelectModal.loaded) {
      personSelectModal.loaded = true;
      modal.innerHTML = `
      <div class="modal-content">
        <h2>Select a Person</h2>
        <input type="text" id="person_search" placeholder="Search by name..." />
        <div id="person_list"></div>
        <button id="close_modal">Close</button>
      </div>
    `;
    }

    modal.classList.remove("hidden");
    $("#close_modal").onclick = () => {
      modal.classList.add("hidden");
      resolve();
    };
    $("#person_search").oninput = () => {
      let searchTerm = $("#person_search").value.toLowerCase();
      let personList = $("#person_list");
      personList.innerHTML = "";
      if (searchTerm < 1) return;
      names
        .filter((p) => p.name.toLowerCase().includes(searchTerm))
        .forEach((p) => {
          let tag = makeClickablePersonTag(p.name);
          tag.onclick = () => {
            resolve(p.name);
            modal.classList.add("hidden");
          };
          personList.appendChild(tag);
        });
    };
    $("#person_search").oninput();
  });
}

function makeClickablePersonTag(name) {
  let tag = document.createElement("span");
  tag.classList.add("person-tag");
  tag.innerHTML = name;
  tag.onclick = () => handleClick(name);
  return tag;
}

function populateCalendarMonth(m = month) {
  let birthdays_this_month = all_people
    .filter((e) => e[8])
    .filter((e) => new Date(e[8]).getMonth() == m);
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
        (e) => new Date(e[8]).getDate() == d
      );
      for (let bday of bdays_today) {
        box.appendChild(makeClickablePersonTag(bday[2]));
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
