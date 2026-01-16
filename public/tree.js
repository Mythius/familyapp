(function (global) {
  const canvas = document.getElementById("tree_display");
  const ctx = canvas.getContext("2d");

  // View state
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  // Data state
  let people = [];
  let peopleMap = {};
  let generations = {}; // ID -> generation string from backend
  let rootPersonId = null;

  // Layout constants
  const NODE_WIDTH = 140;
  const NODE_HEIGHT = 50;
  const NODE_RADIUS = 8;
  const HORIZONTAL_SPACING = 20;
  const VERTICAL_SPACING = 100;
  const SPOUSE_GAP = 10;
  const GENERATION_LABEL_WIDTH = 50;

  // Colors
  const COLORS = {
    male: "#a8d5e8",
    female: "#f5c6d6",
    unknown: "#e0e0e0",
    maleBorder: "#5a9fc7",
    femaleBorder: "#d4879c",
    unknownBorder: "#999",
    spouseLine: "#e74c3c",
    childLine: "#666",
    background: "#f8f9fa",
    text: "#333",
    genLabel: "#666"
  };

  // Stored node positions for click detection
  let nodes = [];

  // Zoom at a specific point
  function zoomAt(cx, cy, factor) {
    offsetX = cx - (cx - offsetX) * factor;
    offsetY = cy - (cy - offsetY) * factor;
    scale *= factor;
    draw();
  }

  // Pan the view
  function pan(dx, dy) {
    offsetX += dx;
    offsetY += dy;
    draw();
  }

  // Reset view to center on the tree
  function resetView() {
    scale = 1;
    offsetX = GENERATION_LABEL_WIDTH + 50;
    offsetY = 80;
    draw();
  }

  // Load data from the descendants endpoint
  async function loadTree(personId) {
    rootPersonId = personId;

    try {
      // Fetch descendants with generation data
      generations = await request(`/descendants/${personId}`);

      // Get the IDs we need
      const descendantIds = Object.keys(generations).map(id => parseInt(id));

      // Filter all_people to only include descendants
      people = all_people
        .filter((row, i) => i > 0 && descendantIds.includes(row[0]))
        .map(row => ({
          id: row[0],
          name: row[2],
          gender: row[3],
          mother_id: row[9],
          father_id: row[10],
          spouse_id: row[11] ? Number(row[11]) : null,
          generation: generations[row[0]]
        }));

      peopleMap = Object.fromEntries(people.map(p => [p.id, p]));

      resetView();
    } catch (e) {
      console.error("Error loading tree:", e);
      alert("Error loading tree data");
    }
  }

  // Build layout - BOTTOM-UP approach for dense families
  // First layout the lowest generation, then work upward positioning parents above children
  function buildLayout() {
    const positions = new Map();

    if (people.length === 0) return positions;

    // Group people by their integer generation (1, 2, 3, etc.)
    const genGroups = new Map();

    for (const person of people) {
      const gen = Math.floor(parseFloat(person.generation));
      if (!genGroups.has(gen)) genGroups.set(gen, []);
      genGroups.get(gen).push(person);
    }

    // Sort generations (ascending)
    const sortedGens = [...genGroups.keys()].sort((a, b) => a - b);
    const maxGen = sortedGens[sortedGens.length - 1];

    // Build parent-to-children map
    const childrenByParent = new Map();
    for (const person of people) {
      if (person.generation.includes(".")) continue; // Skip spouses

      const parentKey = `${person.father_id || 0}-${person.mother_id || 0}`;
      if (!childrenByParent.has(parentKey)) {
        childrenByParent.set(parentKey, []);
      }
      childrenByParent.get(parentKey).push(person);
    }

    // Helper to create units (couples or singles) from a list of people
    function createUnits(peopleList) {
      const placed = new Set();
      const units = [];

      for (const person of peopleList) {
        if (placed.has(person.id)) continue;

        const spouse = person.spouse_id ? peopleMap[person.spouse_id] : null;
        const personGen = Math.floor(parseFloat(person.generation));
        const spouseInSameGen = spouse && Math.floor(parseFloat(spouse.generation)) === personGen;

        if (spouseInSameGen && !placed.has(spouse.id)) {
          // Couple - blood relative first
          const personIsBlood = !person.generation.includes(".");
          if (personIsBlood) {
            units.push({ type: "couple", person1: person, person2: spouse, width: NODE_WIDTH * 2 + SPOUSE_GAP });
          } else {
            units.push({ type: "couple", person1: spouse, person2: person, width: NODE_WIDTH * 2 + SPOUSE_GAP });
          }
          placed.add(person.id);
          placed.add(spouse.id);
        } else {
          units.push({ type: "single", person: person, width: NODE_WIDTH });
          placed.add(person.id);
        }
      }

      return units;
    }

    // Helper to get unit width including spacing
    function getUnitFullWidth(unit) {
      return unit.width + HORIZONTAL_SPACING;
    }

    // Helper to sort people by their parents (so siblings stay together)
    function sortByParents(peopleList) {
      return [...peopleList].sort((a, b) => {
        // Sort by father_id first, then mother_id, then by their own id
        const aFather = a.father_id || 0;
        const bFather = b.father_id || 0;
        if (aFather !== bFather) return aFather - bFather;

        const aMother = a.mother_id || 0;
        const bMother = b.mother_id || 0;
        if (aMother !== bMother) return aMother - bMother;

        return a.id - b.id;
      });
    }

    // BOTTOM-UP: Start from the deepest generation and work up
    for (let gen = maxGen; gen >= 1; gen--) {
      const peopleInGen = genGroups.get(gen) || [];
      if (peopleInGen.length === 0) continue;

      const y = (gen - 1) * (NODE_HEIGHT + VERTICAL_SPACING);

      if (gen === maxGen) {
        // Bottom generation: sort by parents first, then lay out left to right
        const sortedPeople = sortByParents(peopleInGen);
        const units = createUnits(sortedPeople);
        let x = 0;
        for (const unit of units) {
          if (unit.type === "couple") {
            positions.set(unit.person1.id, { x, y, person: unit.person1 });
            positions.set(unit.person2.id, { x: x + NODE_WIDTH + SPOUSE_GAP, y, person: unit.person2 });
          } else {
            positions.set(unit.person.id, { x, y, person: unit.person });
          }
          x += getUnitFullWidth(unit);
        }
      } else {
        // Upper generations: position based on children's positions
        const sortedPeople = sortByParents(peopleInGen);
        const units = createUnits(sortedPeople);

        // For each unit, calculate ideal position based on children
        const unitPositions = [];

        for (const unit of units) {
          const parentIds = unit.type === "couple"
            ? [unit.person1.id, unit.person2.id]
            : [unit.person.id];

          // Find all children of this unit
          let childXs = [];
          for (const parentId of parentIds) {
            for (const person of people) {
              if (person.generation.includes(".")) continue;
              if (person.father_id === parentId || person.mother_id === parentId) {
                if (positions.has(person.id)) {
                  childXs.push(positions.get(person.id).x + NODE_WIDTH / 2);
                }
              }
            }
          }

          let idealX;
          if (childXs.length > 0) {
            // Center above children
            const minChildX = Math.min(...childXs);
            const maxChildX = Math.max(...childXs);
            const childCenter = (minChildX + maxChildX) / 2;
            idealX = childCenter - unit.width / 2;
          } else {
            // No children - check if this is a spouse who should be positioned near their partner
            idealX = null;
          }

          unitPositions.push({ unit, idealX, width: unit.width });
        }

        // Sort by ideal position (nulls at end for now)
        unitPositions.sort((a, b) => {
          if (a.idealX === null && b.idealX === null) return 0;
          if (a.idealX === null) return 1;
          if (b.idealX === null) return -1;
          return a.idealX - b.idealX;
        });

        // Place units, resolving overlaps
        const placedUnits = [];

        for (const up of unitPositions) {
          let x = up.idealX !== null ? up.idealX : 0;

          // Find a position that doesn't overlap
          let placed = false;
          while (!placed) {
            let overlaps = false;
            for (const pu of placedUnits) {
              const puRight = pu.x + pu.width + HORIZONTAL_SPACING;
              const upRight = x + up.width;
              if (!(x >= puRight || upRight + HORIZONTAL_SPACING <= pu.x)) {
                overlaps = true;
                // Move to the right of this unit
                x = Math.max(x, puRight);
              }
            }
            if (!overlaps) placed = true;
          }

          up.x = x;
          placedUnits.push({ x: up.x, width: up.width });

          // Set positions
          const unit = up.unit;
          if (unit.type === "couple") {
            positions.set(unit.person1.id, { x, y, person: unit.person1 });
            positions.set(unit.person2.id, { x: x + NODE_WIDTH + SPOUSE_GAP, y, person: unit.person2 });
          } else {
            positions.set(unit.person.id, { x, y, person: unit.person });
          }
        }
      }
    }

    // Post-process: position childless spouses next to their partner
    for (const person of people) {
      if (!person.generation.includes(".")) continue; // Only process spouses
      if (!positions.has(person.id)) continue;

      // Find the partner (the blood relative this spouse is married to)
      const partnerId = person.spouse_id;
      if (!partnerId || !positions.has(partnerId)) continue;

      const partnerPos = positions.get(partnerId);
      const spousePos = positions.get(person.id);

      // Check if this spouse has any children with the partner
      let hasChildren = false;
      for (const p of people) {
        if (p.generation.includes(".")) continue;
        if (p.father_id === person.id || p.mother_id === person.id ||
            p.father_id === partnerId || p.mother_id === partnerId) {
          // Check if both parents match this couple
          const parents = [p.father_id, p.mother_id];
          if (parents.includes(person.id) || parents.includes(partnerId)) {
            hasChildren = true;
            break;
          }
        }
      }

      // If no children, position spouse right next to partner
      if (!hasChildren) {
        const newX = partnerPos.x + NODE_WIDTH + SPOUSE_GAP;
        spousePos.x = newX;
      }
    }

    // Normalize positions (shift everything so min x is 0)
    let minX = Infinity;
    for (const pos of positions.values()) {
      minX = Math.min(minX, pos.x);
    }
    if (minX !== Infinity && minX !== 0) {
      for (const pos of positions.values()) {
        pos.x -= minX;
      }
    }

    return positions;
  }

  // Draw the tree
  function draw() {
    if (!canvas) return;

    // Resize canvas to fill container
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight - 50; // Account for controls

    // Apply transform
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    // Clear background
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(
      -offsetX / scale,
      -offsetY / scale,
      canvas.width / scale,
      canvas.height / scale
    );

    nodes = [];

    if (people.length === 0) {
      // Draw placeholder text
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = COLORS.genLabel;
      ctx.font = "16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Select a person above to view their family tree", canvas.width / 2, canvas.height / 2);
      return;
    }

    const positions = buildLayout();

    // Draw generation labels
    const genNumbers = [...new Set(people.map(p => Math.floor(parseFloat(p.generation))))].sort((a, b) => a - b);
    ctx.fillStyle = COLORS.genLabel;
    ctx.font = "bold 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "right";

    for (const gen of genNumbers) {
      const y = (gen - 1) * (NODE_HEIGHT + VERTICAL_SPACING) + NODE_HEIGHT / 2 + 5;
      ctx.fillText(`Gen ${gen}`, -20, y);
    }

    // Draw connections first (behind nodes)
    ctx.lineWidth = 2;

    // Draw spouse connections (horizontal red lines)
    const drawnSpouseLines = new Set();
    for (const person of people) {
      if (person.spouse_id && positions.has(person.id) && positions.has(person.spouse_id)) {
        const key = [person.id, person.spouse_id].sort().join("-");
        if (drawnSpouseLines.has(key)) continue;
        drawnSpouseLines.add(key);

        const pos1 = positions.get(person.id);
        const pos2 = positions.get(person.spouse_id);

        // Draw horizontal line between spouses
        const y = pos1.y + NODE_HEIGHT / 2;
        const x1 = Math.min(pos1.x, pos2.x) + NODE_WIDTH;
        const x2 = Math.max(pos1.x, pos2.x);

        if (x2 > x1) {
          ctx.strokeStyle = COLORS.spouseLine;
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x2, y);
          ctx.stroke();
        }
      }
    }

    // Draw parent-child connections
    for (const person of people) {
      if (!positions.has(person.id)) continue;
      const childPos = positions.get(person.id);

      // Skip spouses (they don't have parent lines in this tree)
      if (person.generation.includes(".")) continue;

      // Find parents
      const parents = [];
      if (person.father_id && positions.has(person.father_id)) {
        parents.push(positions.get(person.father_id));
      }
      if (person.mother_id && positions.has(person.mother_id)) {
        parents.push(positions.get(person.mother_id));
      }

      if (parents.length > 0) {
        // Calculate parent center point
        let parentX;
        if (parents.length === 2) {
          parentX = (parents[0].x + parents[1].x + NODE_WIDTH) / 2;
        } else {
          parentX = parents[0].x + NODE_WIDTH / 2;
        }
        const parentY = parents[0].y + NODE_HEIGHT;

        const childX = childPos.x + NODE_WIDTH / 2;
        const childY = childPos.y;

        // Draw line with elbow
        ctx.strokeStyle = COLORS.childLine;
        ctx.beginPath();
        ctx.moveTo(parentX, parentY);
        const midY = parentY + (childY - parentY) / 2;
        ctx.lineTo(parentX, midY);
        ctx.lineTo(childX, midY);
        ctx.lineTo(childX, childY);
        ctx.stroke();
      }
    }

    // Draw nodes
    for (const [id, pos] of positions) {
      const person = pos.person;
      drawNode(pos.x, pos.y, person);
      nodes.push({
        x: pos.x,
        y: pos.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        name: person.name
      });
    }
  }

  // Draw a person node
  function drawNode(x, y, person) {
    // Determine colors based on gender
    let fillColor, borderColor;
    if (person.gender === "Male") {
      fillColor = COLORS.male;
      borderColor = COLORS.maleBorder;
    } else if (person.gender === "Female") {
      fillColor = COLORS.female;
      borderColor = COLORS.femaleBorder;
    } else {
      fillColor = COLORS.unknown;
      borderColor = COLORS.unknownBorder;
    }

    // Draw rounded rectangle
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.roundRect(x, y, NODE_WIDTH, NODE_HEIGHT, NODE_RADIUS);
    ctx.fill();
    ctx.stroke();

    // Draw name
    ctx.fillStyle = COLORS.text;
    ctx.font = "13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = "center";

    // Truncate name if too long
    let displayName = person.name;
    const maxWidth = NODE_WIDTH - 10;
    while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
      displayName = displayName.slice(0, -4) + "...";
    }

    ctx.fillText(displayName, x + NODE_WIDTH / 2, y + NODE_HEIGHT / 2 + 5);

    // Draw small generation indicator
    ctx.font = "10px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillStyle = COLORS.genLabel;
    ctx.textAlign = "left";
    ctx.fillText(person.generation, x + 5, y + 12);
  }

  // Mouse/touch interaction
  let isDragging = false;
  let wasDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let dragStartX = 0;
  let dragStartY = 0;

  canvas.addEventListener("click", (e) => {
    if (wasDragging) {
      wasDragging = false;
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - offsetX) / scale;
    const mouseY = (e.clientY - rect.top - offsetY) / scale;

    for (const node of nodes) {
      if (
        mouseX >= node.x &&
        mouseX <= node.x + node.width &&
        mouseY >= node.y &&
        mouseY <= node.y + node.height
      ) {
        handleClick(node.name);
        break;
      }
    }
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const zoomFactor = e.deltaY < 0 ? 1.05 : 0.95;
    zoomAt(mouseX, mouseY, zoomFactor);
  }, { passive: false });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
      isDragging = true;
      wasDragging = false;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      canvas.style.cursor = "grabbing";
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (isDragging) {
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;

      const totalDx = e.clientX - dragStartX;
      const totalDy = e.clientY - dragStartY;
      if (Math.abs(totalDx) > 5 || Math.abs(totalDy) > 5) {
        wasDragging = true;
      }

      pan(dx, dy);
    }
  });

  canvas.addEventListener("mouseup", (e) => {
    if (e.button === 0) {
      isDragging = false;
      canvas.style.cursor = "grab";
    }
  });

  canvas.addEventListener("mouseleave", () => {
    isDragging = false;
    canvas.style.cursor = "grab";
  });

  canvas.style.cursor = "grab";

  // Touch support
  let lastTouchDist = 0;
  let lastTouchCenter = { x: 0, y: 0 };

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      lastMouseX = e.touches[0].clientX;
      lastMouseY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      isDragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      lastTouchCenter = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };
    }
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - lastMouseX;
      const dy = e.touches[0].clientY - lastMouseY;
      lastMouseX = e.touches[0].clientX;
      lastMouseY = e.touches[0].clientY;
      pan(dx, dy);
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const center = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2
      };

      if (lastTouchDist > 0) {
        const factor = dist / lastTouchDist;
        zoomAt(center.x, center.y, factor);
      }

      lastTouchDist = dist;
      lastTouchCenter = center;
    }
  }, { passive: false });

  canvas.addEventListener("touchend", () => {
    isDragging = false;
    lastTouchDist = 0;
  });

  // Export the tree diagram API
  const TREE_DIAGRAM = {
    loadTree,
    draw,
    resetView,
    zoomAt,
    pan,
    clear: function() {
      people = [];
      generations = {};
      rootPersonId = null;
      draw();
    }
  };

  global.TREE_DIAGRAM = TREE_DIAGRAM;
})(this);
