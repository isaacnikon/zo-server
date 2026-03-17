local script_path = arg[0] or "scripts/trace-client-reward-macros.lua"
local script_dir = script_path:match("^(.*)[/\\][^/\\]+$") or "."
local runtime_path = script_dir .. "/../data/client-derived/task-runtime.lua"
if not runtime_path:match("^/") then
  local pwd = os.getenv("PWD") or "."
  runtime_path = pwd .. "/" .. runtime_path
end

local task_id = tonumber(arg[1] or "")
local output_json = false
local award_value = 1
local rand_sequence = {}

local index = 2
while index <= #arg do
  local value = arg[index]
  if value == "--json" then
    output_json = true
  elseif value == "--award" and index + 1 <= #arg then
    award_value = tonumber(arg[index + 1]) or 1
    index = index + 1
  elseif value == "--rand-seq" and index + 1 <= #arg then
    for part in tostring(arg[index + 1]):gmatch("[^,]+") do
      table.insert(rand_sequence, tonumber(part) or 0)
    end
    index = index + 1
  end
  index = index + 1
end

if not task_id or task_id <= 0 then
  io.stderr:write("usage: lua scripts/trace-client-reward-macros.lua <taskId> [--award N] [--rand-seq a,b,c] [--json]\n")
  os.exit(1)
end

local runtime = dofile(runtime_path)
local reward_blocks = {}
for _, block in ipairs(runtime.rewardBlocks or {}) do
  if block.taskId == task_id then
    table.insert(reward_blocks, block)
  end
end

if #reward_blocks == 0 then
  io.stderr:write(string.format("no reward blocks found for task %d in %s\n", task_id, runtime_path))
  os.exit(1)
end

local function shallow_copy_table(value)
  local copy = {}
  if type(value) ~= "table" then
    return copy
  end
  for key, entry in pairs(value) do
    copy[key] = entry
  end
  return copy
end

local function normalize_snippet(snippet)
  local text = tostring(snippet or "")
  text = text:gsub("\r\n", "\n")
  text = text:gsub("end(%a)", "end\n%1")
  text = text:gsub("(%d)if%(", "%1\nif(")
  return text
end

local function build_env(config)
  local trace = {
    awardReads = {},
    randReads = {},
    itemAdds = {},
    petAdds = {},
    expAdds = {},
    moneyAdds = {},
    coinAdds = {},
    renownAdds = {},
    taskFinished = {},
    taskSteps = {},
    taskKillParams = {},
    taskItemParams = {},
    overNpcs = {},
    playerVars = {},
  }

  local state = {
    awardValue = config.awardValue or 1,
    randIndex = 1,
    randSequence = config.randSequence or {},
    playerAttr = {
      [30] = 0,
      [32] = 1,
    },
    playerVar = {
      [19] = 0,
    },
    date = { 2008, 5, 10, 6 },
  }

  local env = {
    math = math,
    string = string,
    table = table,
    ipairs = ipairs,
    pairs = pairs,
    tonumber = tonumber,
    tostring = tostring,
    type = type,
    next = next,
  }

  local function next_rand(max_value)
    local raw = state.randSequence[state.randIndex]
    state.randIndex = state.randIndex + 1
    if type(raw) ~= "number" then
      raw = 0
    end
    if type(max_value) == "number" and max_value > 0 then
      raw = raw % max_value
    end
    table.insert(trace.randReads, { requested = max_value, returned = raw })
    return raw
  end

  env.macro_GetSelectAward = function()
    table.insert(trace.awardReads, state.awardValue)
    return state.awardValue
  end

  env.macro_Rand = function(max_value)
    return next_rand(max_value)
  end

  env.macro_GetPlayerAttr = function(index_value)
    return state.playerAttr[index_value] or 0
  end

  env.macro_GetPlayerVar = function(index_value)
    return state.playerVar[index_value] or 0
  end

  env.macro_SetPlayerVar = function(index_value, value, _)
    state.playerVar[index_value] = value
    trace.playerVars[index_value] = value
  end

  env.macro_Data = function()
    return state.date[1], state.date[2], state.date[3], state.date[4]
  end

  env.macro_Chu = function(left, right)
    if right == 0 then
      return 0
    end
    return math.floor(left / right)
  end

  env.macro_AddItem = function(template_id, quantity, bind_flag)
    table.insert(trace.itemAdds, {
      templateId = template_id,
      quantity = quantity,
      bindFlag = bind_flag,
    })
  end

  env.macro_AddItemBangDing = env.macro_AddItem

  env.macro_AddPet = function(template_id)
    table.insert(trace.petAdds, template_id)
  end

  env.macro_AddExp = function(value)
    table.insert(trace.expAdds, value)
  end

  env.macro_AddMoney = function(value)
    table.insert(trace.moneyAdds, value)
  end

  env.macro_AddTongBan = function(value)
    table.insert(trace.coinAdds, value)
  end

  env.macro_AddRp = function(value)
    table.insert(trace.renownAdds, value)
  end

  env.macro_SetTaskFinished = function(value)
    table.insert(trace.taskFinished, value)
  end

  env.macro_SetTaskStep = function(value)
    table.insert(trace.taskSteps, value)
  end

  env.macro_SetTaskKillParam = function(monster_id, count, index_value)
    table.insert(trace.taskKillParams, {
      monsterId = monster_id,
      count = count,
      index = index_value,
    })
  end

  env.macro_SetTaskItemParam = function(template_id, count, index_value)
    table.insert(trace.taskItemParams, {
      templateId = template_id,
      count = count,
      index = index_value,
    })
  end

  env.macro_SetOverNpc = function(npc_id)
    table.insert(trace.overNpcs, npc_id)
  end

  setmetatable(env, {
    __index = function(_, key)
      if key == "_G" then
        return env
      end
      return function(...)
        return ...
      end
    end,
  })

  return env, trace, state
end

local function run_block(block, config)
  local env, trace, state = build_env(config)
  local snippet = normalize_snippet(block.rawSnippet or "")
  local chunk, err = load(snippet, string.format("task_%d_reward", block.taskId), "t", env)
  if not chunk then
    return {
      taskId = block.taskId,
      lineStart = block.lineStart,
      lineEnd = block.lineEnd,
      error = err,
      rawSnippet = snippet,
    }
  end

  local ok, runtime_err = pcall(chunk)
  if not ok then
    return {
      taskId = block.taskId,
      lineStart = block.lineStart,
      lineEnd = block.lineEnd,
      error = runtime_err,
      rawSnippet = snippet,
      partialTrace = trace,
    }
  end

  return {
    taskId = block.taskId,
    lineStart = block.lineStart,
    lineEnd = block.lineEnd,
    awardValue = state.awardValue,
    rawSnippet = snippet,
    trace = trace,
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
    for key, _ in pairs(value) do
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
    local keys = {}
    for key, _ in pairs(value) do
      table.insert(keys, key)
    end
    table.sort(keys, function(left, right)
      return tostring(left) < tostring(right)
    end)
    local parts = {}
    for _, key in ipairs(keys) do
      table.insert(parts, "\"" .. escape_json_string(key) .. "\":" .. to_json(value[key]))
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  return "null"
end

local function render_result(result)
  io.write(string.format("task=%d lines=%d-%d award=%d\n", result.taskId, result.lineStart or 0, result.lineEnd or 0, result.awardValue or award_value))
  if result.error then
    io.write("  error: " .. tostring(result.error) .. "\n")
    return
  end
  io.write("  award reads: " .. table.concat(result.trace.awardReads, ", ") .. "\n")
  if #result.trace.randReads > 0 then
    local parts = {}
    for _, entry in ipairs(result.trace.randReads) do
      table.insert(parts, string.format("%s->%s", tostring(entry.requested), tostring(entry.returned)))
    end
    io.write("  rand reads: " .. table.concat(parts, ", ") .. "\n")
  end
  if #result.trace.itemAdds > 0 then
    local parts = {}
    for _, item in ipairs(result.trace.itemAdds) do
      table.insert(parts, string.format("%dx%d", item.templateId, item.quantity))
    end
    io.write("  add item: " .. table.concat(parts, ", ") .. "\n")
  end
  if #result.trace.petAdds > 0 then
    local parts = {}
    for _, item in ipairs(result.trace.petAdds) do
      table.insert(parts, tostring(item))
    end
    io.write("  add pet: " .. table.concat(parts, ", ") .. "\n")
  end
  if #result.trace.expAdds > 0 then
    io.write("  add exp: " .. table.concat(result.trace.expAdds, ", ") .. "\n")
  end
  if #result.trace.moneyAdds > 0 then
    io.write("  add money: " .. table.concat(result.trace.moneyAdds, ", ") .. "\n")
  end
  if #result.trace.coinAdds > 0 then
    io.write("  add coins: " .. table.concat(result.trace.coinAdds, ", ") .. "\n")
  end
  if #result.trace.taskFinished > 0 then
    io.write("  task finished: " .. table.concat(result.trace.taskFinished, ", ") .. "\n")
  end
end

local results = {}
for _, block in ipairs(reward_blocks) do
  table.insert(results, run_block(block, {
    awardValue = award_value,
    randSequence = shallow_copy_table(rand_sequence),
  }))
end

if output_json then
  io.write(to_json(results) .. "\n")
else
  for _, result in ipairs(results) do
    render_result(result)
  end
end
