local script_path = arg[0] or "scripts/trace-client-task-state-macros.lua"
local script_dir = script_path:match("^(.*)[/\\][^/\\]+$") or "."
local state_path = script_dir .. "/../data/client-derived/task-state-clusters.lua"
if not state_path:match("^/") then
  local pwd = os.getenv("PWD") or "."
  state_path = pwd .. "/" .. state_path
end

local cluster_index = tonumber(arg[1] or "")
local output_json = false
for i = 1, #arg do
  if arg[i] == "--json" then
    output_json = true
  end
end

if not cluster_index or cluster_index <= 0 then
  io.stderr:write("usage: lua scripts/trace-client-task-state-macros.lua <clusterIndex> [--json]\n")
  os.exit(1)
end

local state_data = dofile(state_path)
local cluster = nil
for _, entry in ipairs(state_data.clusters or {}) do
  if entry.clusterIndex == cluster_index then
    cluster = entry
    break
  end
end

if not cluster then
  io.stderr:write(string.format("cluster %d not found in %s\n", cluster_index, state_path))
  os.exit(1)
end

local function normalize_snippet(snippet)
  local text = tostring(snippet or "")
  text = text:gsub("\r\n", "\n")
  text = text:gsub("end(%a)", "end\n%1")
  text = text:gsub("(%d)if%(", "%1\nif(")
  return text
end

local function build_env()
  local trace = {
    itemAdds = {},
    taskSteps = {},
    taskMaxSteps = {},
    taskTypes = {},
    taskItemParams = {},
    taskKillParams = {},
    overNpcs = {},
    maxAwards = {},
    dropRates = {},
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

  env.macro_AddItem = function(template_id, quantity, bind_flag)
    table.insert(trace.itemAdds, {
      templateId = template_id,
      quantity = quantity,
      bindFlag = bind_flag,
    })
  end

  env.macro_AddItemBangDing = env.macro_AddItem

  env.macro_SetTaskStep = function(value)
    table.insert(trace.taskSteps, value)
  end

  env.macro_SetTaskMaxStep = function(value)
    table.insert(trace.taskMaxSteps, value)
  end

  env.macro_SetTaskType = function(value)
    table.insert(trace.taskTypes, value)
  end

  env.macro_SetTaskItemParam = function(template_id, count, index_value)
    table.insert(trace.taskItemParams, {
      templateId = template_id,
      count = count,
      index = index_value,
    })
  end

  env.macro_SetTaskKillParam = function(monster_id, count, index_value)
    table.insert(trace.taskKillParams, {
      monsterId = monster_id,
      count = count,
      index = index_value,
    })
  end

  env.macro_SetOverNpc = function(npc_id)
    table.insert(trace.overNpcs, npc_id)
  end

  env.macro_SetMaxAward = function(value)
    table.insert(trace.maxAwards, value)
  end

  env.macro_SetTaskDropRate = function(value)
    table.insert(trace.dropRates, value)
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

  return env, trace
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

local env, trace = build_env()
local snippet = normalize_snippet(cluster.rawSnippet or "")
local chunk, err = load(snippet, string.format("task_state_cluster_%d", cluster.clusterIndex), "t", env)
local result

if not chunk then
  result = {
    clusterIndex = cluster.clusterIndex,
    lineStart = cluster.lineStart,
    lineEnd = cluster.lineEnd,
    error = err,
    rawSnippet = snippet,
  }
else
  local ok, runtime_err = pcall(chunk)
  if not ok then
    result = {
      clusterIndex = cluster.clusterIndex,
      lineStart = cluster.lineStart,
      lineEnd = cluster.lineEnd,
      error = runtime_err,
      rawSnippet = snippet,
      partialTrace = trace,
    }
  else
    result = {
      clusterIndex = cluster.clusterIndex,
      lineStart = cluster.lineStart,
      lineEnd = cluster.lineEnd,
      rawSnippet = snippet,
      trace = trace,
      extracted = {
        maxStep = cluster.maxStep,
        taskType = cluster.taskType,
        overNpcId = cluster.overNpcId,
        maxAward = cluster.maxAward,
        taskStep = cluster.taskStep,
        itemParams = cluster.itemParams or {},
        killParams = cluster.killParams or {},
        addedItems = cluster.addedItems or {},
        dropRate = cluster.dropRate,
      },
    }
  end
end

if output_json then
  io.write(to_json(result) .. "\n")
else
  io.write(string.format(
    "cluster=%d lines=%d-%d maxStep=%s taskType=%s overNpc=%s step=%s\n",
    result.clusterIndex or cluster.clusterIndex,
    result.lineStart or 0,
    result.lineEnd or 0,
    tostring(cluster.maxStep),
    tostring(cluster.taskType),
    tostring(cluster.overNpcId),
    tostring(cluster.taskStep)
  ))
  if result.error then
    io.write("  error: " .. tostring(result.error) .. "\n")
  else
    local function count(value)
      return type(value) == "table" and #value or 0
    end
    io.write(string.format(
      "  trace: maxSteps=%d taskTypes=%d overNpcs=%d itemParams=%d killParams=%d items=%d dropRates=%d maxAwards=%d taskSteps=%d\n",
      count(result.trace.taskMaxSteps),
      count(result.trace.taskTypes),
      count(result.trace.overNpcs),
      count(result.trace.taskItemParams),
      count(result.trace.taskKillParams),
      count(result.trace.itemAdds),
      count(result.trace.dropRates),
      count(result.trace.maxAwards),
      count(result.trace.taskSteps)
    ))
  end
end
