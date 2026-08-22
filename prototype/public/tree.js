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

  // Build layout - TWO-PASS approach for multi-generation families
  // Pass 1: Sort all generations TOP-DOWN to establish correct ordering
  // Pass 2: Layout BOTTOM-UP using the established order
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
    const minGen = sortedGens[0];
    const maxGen = sortedGens[sortedGens.length - 1];

    // Helper to get all spouses of a person (handles multiple spouses)
    function getSpouses(person) {
      const spouses = [];
      const personGen = Math.floor(parseFloat(person.generation));

      // Check person's spouse_id
      if (person.spouse_id && peopleMap[person.spouse_id]) {
        const spouse = peopleMap[person.spouse_id];
        if (Math.floor(parseFloat(spouse.generation)) === personGen) {
          spouses.push(spouse);
        }
      }

      // Check if anyone has this person as their spouse (reverse lookup for multiple spouses)
      for (const p of people) {
        if (p.id === person.id) continue;
        if (Math.floor(parseFloat(p.generation)) !== personGen) continue;
        if (p.spouse_id === person.id && !spouses.find(s => s.id === p.id)) {
          spouses.push(p);
        }
      }

      return spouses;
    }

    // Helper to create units (blood relative + all their spouses)
    function createUnits(orderedBloodDescendants) {
      const placed = new Set();
      const units = [];

      for (const person of orderedBloodDescendants) {
        if (placed.has(person.id)) continue;
        if (person.generation.includes(".")) continue; // Skip spouses in this loop

        placed.add(person.id);

        // Get all spouses for this person
        const spouses = getSpouses(person).filter(s => !placed.has(s.id));

        if (spouses.length > 0) {
          // Mark all spouses as placed
          spouses.forEach(s => placed.add(s.id));

          // Create unit with blood relative first, then spouses
          const allInUnit = [person, ...spouses];
          const width = allInUnit.length * NODE_WIDTH + (allInUnit.length - 1) * SPOUSE_GAP;
          units.push({ type: "family", members: allInUnit, width });
        } else {
          units.push({ type: "single", person: person, width: NODE_WIDTH });
        }
      }

      return units;
    }

    // Helper to get unit width including spacing
    function getUnitFullWidth(unit) {
      return unit.width + HORIZONTAL_SPACING;
    }

    // ============================================
    // PASS 1: TOP-DOWN SORT to establish order
    // ============================================
    // This creates a canonical ordering for each generation based on parent order

    const orderedByGen = new Map(); // gen -> ordered list of blood descendants

    for (const gen of sortedGens) {
      const peopleInGen = genGroups.get(gen) || [];
      const bloodDescendants = peopleInGen.filter(p => !p.generation.includes("."));

      if (gen === minGen) {
        // First generation: just sort by id
        bloodDescendants.sort((a, b) => a.id - b.id);
        orderedByGen.set(gen, bloodDescendants);
      } else {
        // Get parent generation's order
        const parentOrder = orderedByGen.get(gen - 1) || [];
        const parentIndexMap = new Map();
        parentOrder.forEach((p, idx) => parentIndexMap.set(p.id, idx));

        // Also include spouses in parent index map (same index as their partner)
        for (const p of parentOrder) {
          const spouses = getSpouses(p);
          for (const spouse of spouses) {
            if (!parentIndexMap.has(spouse.id)) {
              parentIndexMap.set(spouse.id, parentIndexMap.get(p.id));
            }
          }
        }

        // Sort children by their parents' order
        bloodDescendants.sort((a, b) => {
          // Get parent indices (use the lower index if both parents exist)
          const aFatherIdx = parentIndexMap.has(a.father_id) ? parentIndexMap.get(a.father_id) : Infinity;
          const aMotherIdx = parentIndexMap.has(a.mother_id) ? parentIndexMap.get(a.mother_id) : Infinity;
          const aParentIdx = Math.min(aFatherIdx, aMotherIdx);

          const bFatherIdx = parentIndexMap.has(b.father_id) ? parentIndexMap.get(b.father_id) : Infinity;
          const bMotherIdx = parentIndexMap.has(b.mother_id) ? parentIndexMap.get(b.mother_id) : Infinity;
          const bParentIdx = Math.min(bFatherIdx, bMotherIdx);

          if (aParentIdx !== bParentIdx) return aParentIdx - bParentIdx;

          // Same parents - sort by id
          return a.id - b.id;
        });

        orderedByGen.set(gen, bloodDescendants);
      }
    }

    // ============================================
    // PASS 2: BOTTOM-UP LAYOUT using established order
    // ============================================

    for (let gen = maxGen; gen >= minGen; gen--) {
      const orderedBlood = orderedByGen.get(gen) || [];
      if (orderedBlood.length === 0) continue;

      const y = (gen - 1) * (NODE_HEIGHT + VERTICAL_SPACING);
      const units = createUnits(orderedBlood);

      if (gen === maxGen) {
        // Bottom generation: lay out left to right in order
        let x = 0;
        for (const unit of units) {
          if (unit.type === "family") {
            let memberX = x;
            for (const member of unit.members) {
              positions.set(member.id, { x: memberX, y, person: member });
              memberX += NODE_WIDTH + SPOUSE_GAP;
            }
          } else {
            positions.set(unit.person.id, { x, y, person: unit.person });
          }
          x += getUnitFullWidth(unit);
        }
      } else {
        // Upper generations: position based on children's positions
        // BUT preserve the sibling order from Pass 1

        // First, calculate ideal positions for each unit
        const unitPositions = [];

        for (const unit of units) {
          const memberIds = unit.type === "family"
            ? unit.members.map(m => m.id)
            : [unit.person.id];

          // Find all children of any member in this unit
          let childXs = [];
          for (const memberId of memberIds) {
            for (const person of people) {
              if (person.generation.includes(".")) continue;
              if (person.father_id === memberId || person.mother_id === memberId) {
                if (positions.has(person.id)) {
                  childXs.push(positions.get(person.id).x + NODE_WIDTH / 2);
                }
              }
            }
          }

          let idealX;
          if (childXs.length > 0) {
            const minChildX = Math.min(...childXs);
            const maxChildX = Math.max(...childXs);
            const childCenter = (minChildX + maxChildX) / 2;
            idealX = childCenter - unit.width / 2;
          } else {
            idealX = null; // Will be interpolated
          }

          unitPositions.push({ unit, idealX, width: unit.width });
        }

        // Interpolate positions for units without children (unmarried siblings)
        // They should be positioned between their adjacent siblings
        for (let i = 0; i < unitPositions.length; i++) {
          if (unitPositions[i].idealX === null) {
            // Find nearest positioned siblings on left and right
            let leftX = null;
            let rightX = null;
            let leftIdx = -1;
            let rightIdx = -1;

            for (let j = i - 1; j >= 0; j--) {
              if (unitPositions[j].idealX !== null) {
                leftX = unitPositions[j].idealX + unitPositions[j].width;
                leftIdx = j;
                break;
              }
            }

            for (let j = i + 1; j < unitPositions.length; j++) {
              if (unitPositions[j].idealX !== null) {
                rightX = unitPositions[j].idealX;
                rightIdx = j;
                break;
              }
            }

            // Calculate position based on neighbors
            if (leftX !== null && rightX !== null) {
              // Between two positioned siblings - interpolate
              const gap = rightX - leftX;
              const unpositionedCount = rightIdx - leftIdx - 1;
              const posInGap = i - leftIdx;
              const spacing = gap / (unpositionedCount + 1);
              unitPositions[i].idealX = leftX + spacing * posInGap;
            } else if (leftX !== null) {
              // Only left neighbor - place to the right
              unitPositions[i].idealX = leftX + HORIZONTAL_SPACING;
            } else if (rightX !== null) {
              // Only right neighbor - place to the left
              unitPositions[i].idealX = rightX - unitPositions[i].width - HORIZONTAL_SPACING;
            } else {
              // No neighbors positioned - start at 0
              unitPositions[i].idealX = 0;
            }
          }
        }

        // Now place units in ORDER (preserving Pass 1 order), adjusting for overlaps
        const placedUnits = [];

        for (const up of unitPositions) {
          let x = up.idealX;

          // Check for overlaps with already placed units and shift if needed
          let needsShift = true;
          while (needsShift) {
            needsShift = false;
            for (const pu of placedUnits) {
              const puRight = pu.x + pu.width + HORIZONTAL_SPACING;
              const upRight = x + up.width;
              // Check if overlapping
              if (!(x >= puRight || upRight <= pu.x - HORIZONTAL_SPACING)) {
                // Overlap detected - shift right
                x = Math.max(x, puRight);
                needsShift = true;
              }
            }
          }

          up.x = x;
          placedUnits.push({ x: up.x, width: up.width });

          // Set positions for all members
          const unit = up.unit;
          if (unit.type === "family") {
            let memberX = x;
            for (const member of unit.members) {
              positions.set(member.id, { x: memberX, y, person: member });
              memberX += NODE_WIDTH + SPOUSE_GAP;
            }
          } else {
            positions.set(unit.person.id, { x, y, person: unit.person });
          }
        }
      }
    }

    // ============================================
    // PASS 3: Post-process childless spouses
    // ============================================
    // Position childless spouses right next to their partner

    for (const person of people) {
      if (!person.generation.includes(".")) continue;
      if (!positions.has(person.id)) continue;

      const partnerId = person.spouse_id;
      if (!partnerId || !positions.has(partnerId)) continue;

      const partnerPos = positions.get(partnerId);
      const spousePos = positions.get(person.id);

      // Check if this spouse has any children
      let hasChildren = false;
      for (const p of people) {
        if (p.generation.includes(".")) continue;
        if (p.father_id === person.id || p.mother_id === person.id) {
          hasChildren = true;
          break;
        }
      }

      // If no children, position spouse right next to partner
      if (!hasChildren) {
        spousePos.x = partnerPos.x + NODE_WIDTH + SPOUSE_GAP;
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
