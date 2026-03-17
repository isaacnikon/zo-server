local script_path = arg[0] or "scripts/trace-client-quest-runtime.lua"
local script_dir = script_path:match("^(.*)[/\\][^/\\]+$") or "."
local schema_path = script_dir .. "/../data/client-derived/quest-schema.lua"

local task_id = tonumber(arg[1] or "")
local output_json = false
for i = 1, #arg do
  if arg[i] == "--json" then
    output_json = true
  end
end

if not task_id or task_id <= 0 then
  io.stderr:write("usage: lua scripts/trace-client-quest-runtime.lua <taskId> [--json]\n")
  os.exit(1)
end

local schema = dofile(schema_path)
local quest = nil
for _, entry in ipairs(schema.quests or {}) do
  if entry.taskId == task_id then
    quest = entry
    break
  end
end

if not quest then
  io.stderr:write(string.format("quest %d not found in %s\n", task_id, schema_path))
  os.exit(1)
end

local function normalize_items(items)
  local normalized = {}
  if type(items) ~= "table" then
    return normalized
  end
  for _, item in ipairs(items) do
    if type(item) == "table" and type(item.templateId) == "number" then
      table.insert(normalized, {
        templateId = item.templateId,
        quantity = type(item.quantity) == "number" and item.quantity or 1,
        name = type(item.name) == "string" and item.name or "",
      })
    end
  end
  return normalized
end

local function infer_completion_npc_id(steps)
  if type(steps) ~= "table" or #steps == 0 then
    return nil
  end
  return steps[#steps].npcId
end

local function normalize_reward_summary(reward)
  local items = {}
  if type(reward) == "table" and type(reward.items) == "table" then
    for _, choice in ipairs(reward.items) do
      if type(choice) == "table" and type(choice.items) == "table" then
        for _, item in ipairs(normalize_items(choice.items)) do
          table.insert(items, item)
        end
      end
    end
  end

  return {
    experience = type(reward.experience) == "number" and reward.experience or 0,
    gold = type(reward.gold) == "number" and reward.gold or 0,
    coins = type(reward.coins) == "number" and reward.coins or 0,
    renown = type(reward.renown) == "number" and reward.renown or 0,
    pets = type(reward.pets) == "table" and reward.pets or {},
    items = items,
  }
end

local function build_trace(quest_entry)
  local events = {}
  table.insert(events, {
    phase = "accept",
    npcId = quest_entry.startNpcId,
    minLevel = quest_entry.minLevel,
    prerequisiteTaskId = quest_entry.prerequisiteTaskId,
    grantItems = normalize_items(quest_entry.acceptGrantItems),
  })

  for _, step in ipairs(quest_entry.steps or {}) do
    table.insert(events, {
      phase = "step",
      stepIndex = step.stepIndex,
      type = step.type,
      npcId = step.npcId,
      mapId = step.mapId,
      monsterId = step.monsterId,
      count = step.count,
      description = step.description or "",
      consumeItems = normalize_items(step.consumeItems),
    })
  end

  table.insert(events, {
    phase = "complete",
    npcId = infer_completion_npc_id(quest_entry.steps),
    rewards = normalize_reward_summary(quest_entry.rewards or {}),
    runtimeRewardChoices = quest_entry.runtimeRewardChoices or {},
  })

  return {
    taskId = quest_entry.taskId,
    title = quest_entry.title or "",
    eventCount = #events,
    events = events,
    evidence = quest_entry.evidence or {},
  }
end

local function escape_json_string(value)
  return tostring(value)
    :gsub("\\", "\\\\")
    :gsub("\"", "\\\"")
    :gsub("\n", "\\n")
    :gsub("\r", "\\r")
    :gsub("\t", "\\t")
end

local function to_json(value)
  local value_type = type(value)
  if value == nil then
    return "null"
  elseif value_type == "number" or value_type == "boolean" then
    return tostring(value)
  elseif value_type == "string" then
    return "\"" .. escape_json_string(value) .. "\""
  elseif value_type == "table" then
    local is_array = true
    local count = 0
    for key, _ in pairs(value) do
      count = count + 1
      if type(key) ~= "number" then
        is_array = false
        break
      end
    end

    if is_array then
      local parts = {}
      for i = 1, #value do
        table.insert(parts, to_json(value[i]))
      end
      return "[" .. table.concat(parts, ",") .. "]"
    end

    local parts = {}
    for key, entry_value in pairs(value) do
      table.insert(parts, "\"" .. escape_json_string(key) .. "\":" .. to_json(entry_value))
    end
    table.sort(parts)
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

local function format_items(items)
  local parts = {}
  for _, item in ipairs(items) do
    local suffix = item.name ~= "" and ("(" .. item.name .. ")") or ""
    table.insert(parts, string.format("%dx%d%s", item.templateId, item.quantity, suffix))
  end
  return table.concat(parts, ", ")
end

local function display_number(value)
  if value == nil then
    return "-"
  end
  return tostring(value)
end

local function render_trace(trace)
  io.write(string.format("Quest %d: %s\n", trace.taskId, trace.title))
  for _, event in ipairs(trace.events) do
    if event.phase == "accept" then
      io.write(string.format(
        "accept: npc=%s minLevel=%s prereq=%s\n",
        display_number(event.npcId),
        display_number(event.minLevel),
        display_number(event.prerequisiteTaskId)
      ))
      if #event.grantItems > 0 then
        io.write("  grant: " .. format_items(event.grantItems) .. "\n")
      end
    elseif event.phase == "step" then
      local parts = {
        "step " .. display_number(event.stepIndex),
        "type=" .. tostring(event.type or "unknown"),
      }
      if event.npcId ~= nil then
        table.insert(parts, "npc=" .. tostring(event.npcId))
      end
      if event.mapId ~= nil then
        table.insert(parts, "map=" .. tostring(event.mapId))
      end
      if event.monsterId ~= nil then
        table.insert(parts, "monster=" .. tostring(event.monsterId))
      end
      if event.count ~= nil then
        table.insert(parts, "count=" .. tostring(event.count))
      end
      io.write(table.concat(parts, " ") .. "\n")
      if event.description and event.description ~= "" then
        io.write("  " .. event.description .. "\n")
      end
      if #event.consumeItems > 0 then
        io.write("  consume: " .. format_items(event.consumeItems) .. "\n")
      end
    elseif event.phase == "complete" then
      io.write(string.format("complete: npc=%s\n", display_number(event.npcId)))
      io.write(string.format(
        "  reward summary: exp=%d gold=%d coins=%d renown=%d\n",
        event.rewards.experience,
        event.rewards.gold,
        event.rewards.coins,
        event.rewards.renown
      ))
      if #event.rewards.pets > 0 then
        io.write("  reward pets: " .. table.concat(event.rewards.pets, ", ") .. "\n")
      end
      if #event.rewards.items > 0 then
        io.write("  reward items: " .. format_items(event.rewards.items) .. "\n")
      end
      if #(event.runtimeRewardChoices or {}) > 0 then
        io.write("  runtime choices:\n")
        for _, choice in ipairs(event.runtimeRewardChoices) do
          local parts = { "award=" .. display_number(choice.awardId) }
          if choice.experience ~= nil then table.insert(parts, "exp=" .. tostring(choice.experience)) end
          if choice.gold ~= nil then table.insert(parts, "gold=" .. tostring(choice.gold)) end
          if choice.coins ~= nil then table.insert(parts, "coins=" .. tostring(choice.coins)) end
          if choice.renown ~= nil then table.insert(parts, "renown=" .. tostring(choice.renown)) end
          if type(choice.petTemplateIds) == "table" and #choice.petTemplateIds > 0 then
            table.insert(parts, "pets=" .. table.concat(choice.petTemplateIds, ","))
          end
          local choice_items = normalize_items(choice.items)
          if #choice_items > 0 then
            table.insert(parts, "items=" .. format_items(choice_items))
          end
          io.write("    " .. table.concat(parts, " ") .. "\n")
        end
      end
    end
  end
end

local trace = build_trace(quest)

if output_json then
  io.write(to_json(trace) .. "\n")
else
  render_trace(trace)
end
