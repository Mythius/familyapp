const $ = (q) => document.querySelector(q);
let permissions;

// Check if user can edit a specific family
function canEditFamily(familyId) {
  if (!permissions || !permissions.family_permissions) return false;
  const role = permissions.family_permissions[familyId];
  return role === "owner" || role === "editor";
}

// Check if user owns a specific family
function isOwner(familyId) {
  if (!permissions || !permissions.family_permissions) return false;
  return permissions.family_permissions[familyId] === "owner";
}

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
  request("/family_ids").then((roots) => {
    if (roots.length === 0) {
      alert("You need to create a family first. Please add a root person.");
      return;
    }
    let familyIdSelect = $("#family-id");
    familyIdSelect.innerHTML = ""; // Clear previous options
    roots.forEach((familyId) => {
      let option = document.createElement("option");
      option.value = familyId;
      option.textContent = familyId; // Display family ID
      familyIdSelect.appendChild(option);
    });
    let tree_select = $("#tree-family-select");
    tree_select.onchange = function () {
      gotoTree(all_people.filter((e) => e[1] == tree_select.value));
    };
    tree_select.innerHTML = "";
    roots.forEach((familyId) => {
      let option = document.createElement("option");
      option.value = familyId;
      option.textContent = familyId; // Display family ID
      tree_select.appendChild(option);
    });
  });
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

function getIdByName(name) {
  return all_people.filter((e) => e[2] == name)?.[0]?.[0];
}

function gotoCalendar() {
  hideAll();
  $("#calendar").classList.remove("out");
  populateCalendarMonth();
}

function createFamilyDiv(families) {
  let innerHTML = "";
  for (let family of families) {
    const familyId = family.family_id;
    const role = permissions?.family_permissions?.[familyId] || "viewer";
    const roleLabel = role === "owner" ? "Owner" : role === "editor" ? "Editor" : "Viewer";

    innerHTML += /*html*/ `
    <div class="fam-id-span">
      <div name="${familyId}" onclick="updateFamilyRoot(this)" style="cursor:pointer">
        <span class="familyName">${familyId}</span>
        <span class="role-badge ${role}">${roleLabel}</span>
        <br>
        Descendants and Family of
        ${family.ancestor1 || "?"} &
        ${family.ancestor2 || "?"}
      </div>
      ${role === "owner" ? `<button onclick="event.stopPropagation(); managePermissions('${familyId}')" class="manage-btn">Manage Access</button>` : ""}
    </div>
  `;
  }
  innerHTML += /*html*/ `
    <button onclick="addFamily()">Add Family</button><hr>
  `;
  return innerHTML;
}

function wait(t = 1) {
  return new Promise((res, rej) => {
    setTimeout(() => {
      res();
    }, t * 1000);
  });
}

function gotoTree(
  people = all_people.filter(
    (e) => e[1] == $("#tree-family-select").value
  )
) {
  hideAll();
  $("#tree").classList.remove("out");
  const tree_div = $("#tree");
  const canvas = $("#tree_display");
  canvas.width = tree_div.clientWidth;
  canvas.height = tree_div.clientHeight;
  TREE_DIAGRAM.loadPeople(people);
  TREE_DIAGRAM.draw();
}

async function updateFamilyRoot(e) {
  let name = e.getAttribute("name");
  let father = await personSelectModal(
    "Select Patriarch (Eldest Male) of Family"
  );
  await wait(0.1);
  let mother = await personSelectModal(
    "Select Matriarch (Eldest Female) of Family"
  );
  let father_id = getIdByName(father);
  let mother_id = getIdByName(mother);
  request(`/roots/${name}`, {
    method: "POST",
    body: JSON.stringify({ father_id, mother_id }),
  });
  gotoSettings();
}

async function gotoSettings() {
  hideAll();
  $("#settings").classList.remove("out");
  let familyDiv = $("#my-families");
  familyDiv.innerHTML = "Loading...";
  let families = await request("/getMyFamiliesRoots");
  familyDiv.innerHTML = createFamilyDiv(families);
}

async function addFamily() {
  let familyName = prompt(
    "Enter New Family Name (we recommend just last name)"
  );
  if (!familyName) return;
  await request(`/family/${familyName}`, { method: "POST" });
  gotoSettings();
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
  $("#bday").innerHTML =
    birth_date == null
      ? ""
      : new Date(profile.birthday).toLocaleDateString("en-us", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });
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
  $("#mname").innerHTML = profile.maiden_name;
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
  // Check if user can edit this person's family
  if (canEditFamily(profile.family_id)) {
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
        { id: "mname", value: profile.maiden_name },
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
          maiden_name: $("#mname-input").value,
          gender: (() => {
            const genderInput = $("#gender-input");
            if (
              !genderInput ||
              !genderInput.value ||
              genderInput.value === "Not selected"
            ) {
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

function personSelectModal(title = "Select A Person") {
  return new Promise((resolve, reject) => {
    let modal = $("#person_select_modal");
    if (!personSelectModal.loaded) {
      personSelectModal.loaded = true;
      modal.innerHTML = `
      <div class="modal-content">
        <h2>${title}</h2>
        <input type="text" id="person_search" placeholder="Search by name..." />
        <div id="person_list"></div>
        <button id="close_modal">Close</button>
      </div>
    `;
    } else {
      modal.querySelector("h2").innerHTML = title;
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

  if (filteredData.length === 0) {
    $("#create-person").classList.remove("hidden");
  } else {
    $("#create-person").classList.add("hidden");
  }
}

function logout() {
  delete localStorage.auth_token;
  location.reload();
}

$("#create-person").onclick = async () => {
  let modal = $("#add_person");

  modal.classList.remove("hidden");
  $("#name-input").value = $("#search").value.trim();
  $("#new-person-submit").onclick = async () => {
    let nameInput = $("#name-input").value.trim();
    let familyId = $("#family-id").value;
    if (!familyId) {
      alert("Please select a family ID.");
      return;
    }
    if (!nameInput) {
      alert("Name cannot be empty");
      return;
    }
    // Check if name already exists
    if (names.some((p) => p.name.toLowerCase() === nameInput.toLowerCase())) {
      alert("Person with this name already exists.");
      return;
    }
    // Create new person
    await request("/people", {
      method: "POST",
      body: JSON.stringify({ name: nameInput, family_id: familyId }),
    });
    modal.classList.add("hidden");
    main(); // Refresh the table
  };
  $("#new-person-cancel").onclick = () => {
    modal.classList.add("hidden");
    nameInput.value = "";
  };
};

window.addEventListener("popstate", function (event) {
  // Prevent default back button behavior
  event.preventDefault();

  // Call your custom function
  gotoSearch();
});

// Manage family permissions modal
async function managePermissions(familyId) {
  let modal = $("#permissions_modal");
  if (!modal) {
    // Create modal if it doesn't exist
    modal = document.createElement("div");
    modal.id = "permissions_modal";
    modal.className = "modal";
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Manage Access: ${familyId}</h2>
      <div id="permissions_list">Loading...</div>
      <hr>
      <h3>Grant Access</h3>
      <input type="email" id="grant_email" placeholder="Email address" />
      <select id="grant_role">
        <option value="editor">Editor (can edit)</option>
        <option value="viewer">Viewer (read only)</option>
      </select>
      <button onclick="grantPermission('${familyId}')">Grant Access</button>
      <hr>
      <button onclick="closePermissionsModal()">Close</button>
    </div>
  `;
  modal.classList.remove("hidden");

  // Load current permissions
  try {
    let members = await request(`/family-permissions/${encodeURIComponent(familyId)}`);
    let listHtml = "";
    if (members.length === 0) {
      listHtml = "<p>No additional users have access.</p>";
    } else {
      listHtml = "<ul>";
      for (let m of members) {
        listHtml += `<li>${m.email} - ${m.role} <button onclick="revokePermission('${familyId}', '${m.email}')">Revoke</button></li>`;
      }
      listHtml += "</ul>";
    }
    $("#permissions_list").innerHTML = listHtml;
  } catch (e) {
    $("#permissions_list").innerHTML = "<p>Error loading permissions.</p>";
  }
}

function closePermissionsModal() {
  $("#permissions_modal").classList.add("hidden");
}

async function grantPermission(familyId) {
  let email = $("#grant_email").value.trim();
  let role = $("#grant_role").value;

  if (!email) {
    alert("Please enter an email address.");
    return;
  }

  try {
    let result = await request(`/family-permissions/${encodeURIComponent(familyId)}`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });
    if (result.success) {
      alert(result.message);
      $("#grant_email").value = "";
      managePermissions(familyId); // Refresh the list
    } else {
      alert(result.error || "Failed to grant permission.");
    }
  } catch (e) {
    alert("Error granting permission.");
  }
}

async function revokePermission(familyId, email) {
  if (!confirm(`Revoke access from ${email}?`)) return;

  try {
    let result = await request(`/family-permissions/${encodeURIComponent(familyId)}/${encodeURIComponent(email)}`, {
      method: "DELETE",
    });
    if (result.success) {
      alert(result.message);
      managePermissions(familyId); // Refresh the list
    } else {
      alert(result.error || "Failed to revoke permission.");
    }
  } catch (e) {
    alert("Error revoking permission.");
  }
}

// main();
skipSignin();
