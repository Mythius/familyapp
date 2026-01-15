(function (global) {
  const canvas = document.getElementById("tree_display");
  const ctx = canvas.getContext("2d");

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  // You can call these from your pinch/drag handlers:
  function zoomAt(cx, cy, factor) {
    offsetX = cx - (cx - offsetX) * factor;
    offsetY = cy - (cy - offsetY) * factor;
    scale *= factor;
    drawTree();
  }

  function pan(dx, dy) {
    offsetX += dx;
    offsetY += dy;
    drawTree();
  }

  let nodes = []; // list of drawn people with screen coordinates for hit testing

  const nodeWidth = 100;
  const nodeHeight = 40;
  const horizontalSpacing = 30;
  const verticalSpacing = 80;

  // Sample family data:

  // Convert to ID map for easy lookup
  let peopleMap;

  // Compute tree layout
  function buildTreeData() {
    const positions = new Map();
    const xPositions = new Map();
    const generationById = new Map();
    const idMap = Object.fromEntries(people.map((p) => [p.id, p]));
    const childrenMap = new Map();

    // Build children map
    for (const person of people) {
      const parents = [person.father_id, person.mother_id].filter(Boolean);
      for (const parent of parents) {
        if (!childrenMap.has(parent)) childrenMap.set(parent, []);
        childrenMap.get(parent).push(person.id);
      }
    }

    // Step 1: Assign generations with spouse logic
    const visited = new Set();
    const queue = [];

    for (const person of people) {
      const hasParents = person.father_id || person.mother_id;
      const spouse = person.spouse_id ? idMap[person.spouse_id] : null;
      const spouseHasParents = spouse && (spouse.father_id || spouse.mother_id);

      if (!hasParents && (!spouse || !spouseHasParents)) {
        queue.push({ id: person.id, gen: 0 });
        if (spouse) queue.push({ id: spouse.id, gen: 0 });
      }
    }

    while (queue.length) {
      const { id, gen } = queue.shift();
      if (generationById.has(id)) continue;

      generationById.set(id, gen);
      const person = idMap[id];

      if (person.spouse_id && !generationById.has(person.spouse_id)) {
        queue.push({ id: person.spouse_id, gen });
      }

      const children = people.filter(
        (p) => p.father_id === id || p.mother_id === id
      );
      for (const child of children) {
        if (!generationById.has(child.id)) {
          queue.push({ id: child.id, gen: gen + 1 });
        }
      }
    }

    // Step 2: Layout x positions bottom-up
    const levels = new Map();
    const maxGen = Math.max(...generationById.values());

    for (const [id, gen] of generationById.entries()) {
      if (!levels.has(gen)) levels.set(gen, []);
      levels.get(gen).push(idMap[id]);
    }

    let xCounter = 0;

    function setCoupleX(id1, id2, centerX) {
      const spacing = nodeWidth + 10;
      const left = centerX - spacing / 2;
      xPositions.set(id1, left);
      xPositions.set(id2, left + spacing);
    }

    for (let gen = maxGen; gen >= 0; gen--) {
      const peopleAtLevel = levels.get(gen) || [];

      for (const person of peopleAtLevel) {
        const children = people.filter(
          (p) => p.father_id === person.id || p.mother_id === person.id
        );
        const childXs = children
          .map((c) => xPositions.get(c.id))
          .filter(Boolean);

        if (childXs.length > 0) {
          const avgX = childXs.reduce((a, b) => a + b, 0) / childXs.length;
          if (person.spouse_id) {
            setCoupleX(person.id, person.spouse_id, avgX);
          } else if (!xPositions.has(person.id)) {
            xPositions.set(person.id, avgX);
          }
        } else {
          // No children — assign new x position
          if (!xPositions.has(person.id)) {
            const x = xCounter * (nodeWidth + horizontalSpacing + 20);
            xPositions.set(person.id, x);
            if (person.spouse_id && !xPositions.has(person.spouse_id)) {
              xPositions.set(person.spouse_id, x + nodeWidth + 10);
              xCounter++;
            }
            xCounter++;
          }
        }
      }
    }

    // 🔁 Step 3: Ensure all spouses are side-by-side even if not handled above
    for (const person of people) {
      if (
        person.spouse_id &&
        generationById.get(person.id) === generationById.get(person.spouse_id)
      ) {
        const id1 = person.id;
        const id2 = person.spouse_id;

        const spacing = nodeWidth + 10;
        const has1 = xPositions.has(id1);
        const has2 = xPositions.has(id2);

        if (has1 && !has2) {
          xPositions.set(id2, xPositions.get(id1) + spacing);
        } else if (!has1 && has2) {
          xPositions.set(id1, xPositions.get(id2) - spacing);
        } else if (!has1 && !has2) {
          const x = xCounter * (nodeWidth + horizontalSpacing + 20);
          xPositions.set(id1, x);
          xPositions.set(id2, x + spacing);
          xCounter++;
        } else {
          // both are set, but make sure they're properly spaced
          const x1 = xPositions.get(id1);
          const x2 = xPositions.get(id2);
          if (Math.abs(x1 - x2) < spacing - 1e-3) {
            const newLeft = Math.min(x1, x2);
            xPositions.set(id1, newLeft);
            xPositions.set(id2, newLeft + spacing);
          }
        }
      }
    }

    // Step 4: Assign final x/y positions to canvas
    for (const [id, x] of xPositions.entries()) {
      const gen = generationById.get(id);
      positions.set(id, {
        x,
        y: gen * (nodeHeight + verticalSpacing),
      });
    }

    return positions;
  }

  function drawTree() {
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
    ctx.clearRect(
      -offsetX / scale,
      -offsetY / scale,
      canvas.width / scale,
      canvas.height / scale
    );
    nodes = [];

    const positions = buildTreeData();

    // Draw lines first
    for (const person of people) {
      const pos = positions.get(person.id);
      if (!pos) continue;

      if (person.father_id && positions.get(person.father_id)) {
        const p2 = positions.get(person.father_id);
        drawLine(
          p2.x + nodeWidth / 2,
          p2.y + nodeHeight,
          pos.x + nodeWidth / 2,
          pos.y
        );
      }
      if (person.mother_id && positions.get(person.mother_id)) {
        const p2 = positions.get(person.mother_id);
        drawLine(
          p2.x + nodeWidth / 2,
          p2.y + nodeHeight,
          pos.x + nodeWidth / 2,
          pos.y
        );
      }

      if (person.spouse_id && positions.get(person.spouse_id)) {
        const spousePos = positions.get(person.spouse_id);
        drawLine(
          pos.x + nodeWidth,
          pos.y + nodeHeight / 2,
          spousePos.x,
          spousePos.y + nodeHeight / 2
        );
      }
    }

    // Draw people
    for (const person of people) {
      const pos = positions.get(person.id);
      if (!pos) continue;

      const color = person.gender === "Male" ? "#87ceeb" : "#f9c0cb";
      drawNode(pos.x, pos.y, person.name, color);
      nodes.push({
        ...pos,
        width: nodeWidth,
        height: nodeHeight,
        name: person.name,
      });
    }
  }

  function drawLine(x1, y1, x2, y2) {
    ctx.strokeStyle = "#999";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawNode(x, y, name, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, nodeWidth, nodeHeight);
    ctx.strokeStyle = "#333";
    ctx.strokeRect(x, y, nodeWidth, nodeHeight);
    ctx.fillStyle = "#000";
    ctx.font = "14px sans-serif";
    ctx.fillText(name, x + 5, y + 25);
  }

  // Mouse drag support for laptop/desktop
  let isDragging = false;
  let wasDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let dragStartX = 0;
  let dragStartY = 0;

  // Detect click on person box (only if not dragging)
  canvas.addEventListener("click", (e) => {
    // Ignore click if we just finished dragging
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
        onPersonClick(node.name);
        break;
      }
    }
  });

  function onPersonClick(name) {
    handleClick(name);
  }

  // Mouse wheel zoom support for laptop/desktop
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom in or out based on scroll direction (reduced sensitivity)
    // Use smaller zoom factor for smoother trackpad experience
    const zoomFactor = e.deltaY < 0 ? 1.03 : 0.97;
    zoomAt(mouseX, mouseY, zoomFactor);
  }, { passive: false });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) { // Left click
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

      // Check if we've moved enough to consider it a drag
      const totalDx = e.clientX - dragStartX;
      const totalDy = e.clientY - dragStartY;
      if (Math.abs(totalDx) > 5 || Math.abs(totalDy) > 5) {
        wasDragging = true;
      }

      // Apply damping for smoother pan (reduced sensitivity)
      pan(dx * 0.7, dy * 0.7);
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

  // Set initial cursor style
  canvas.style.cursor = "grab";

  const TREE_DIAGRAM = {};

  TREE_DIAGRAM.zoomAt = zoomAt;
  TREE_DIAGRAM.pan = pan;
  TREE_DIAGRAM.loadPeople = function (ap) {
    people = ap
      .map((e) => {
        return {
          id: e[0],
          name: e[2],
          gender: e[3],
          father_id: e[10],
          mother_id: e[9],
          spouse_id: e[11],
        };
      });
    peopleMap = Object.fromEntries(people.map((p) => [p.id, p]));
  };

  TREE_DIAGRAM.draw = drawTree;

  global.TREE_DIAGRAM = TREE_DIAGRAM;

  Touch.init((data) => {
    if (data.type == "zoom") {
      if (scale != 1) debugger;
      zoomAt(data.ct.x, data.ct.y, scale);
    } else if (data.type == "scroll") {
      pan(data.dx, data.dy);
    }
  });
})(this);
