return {
  source = {
    flow = "/home/nikon/projects/zo-server/data/client-derived/quest-flow.json",
    runtime = "/home/nikon/projects/zo-server/data/client-derived/task-runtime.json",
    tasklist = "/home/nikon/projects/zo-server/data/client-derived/quests.json",
    roleinfo = "/home/nikon/projects/zo-server/data/client-derived/roleinfo.json",
    items = {
      "/home/nikon/projects/zo-server/data/client-derived/items.json",
      "/home/nikon/projects/zo-server/data/client-derived/potions.json",
      "/home/nikon/projects/zo-server/data/client-derived/stuff.json",
      "/home/nikon/projects/zo-server/data/client-derived/equipment.json",
      "/home/nikon/projects/zo-server/data/client-derived/weapons.json"
    }
  },
  generatedAt = "2026-03-17T13:20:33.343Z",
  questCount = 160,
  quests = {
    {
      taskId = 1,
      title = "Back to Earth",
      startNpcId = 3054,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 100,
        gold = 0,
        coins = 100,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 20001,
                quantity = 5,
                name = "Medicine"
              },
              {
                templateId = 20004,
                quantity = 5,
                name = "Heal Grass"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 100,
          gold = nil,
          coins = 100,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 20001,
              quantity = 5,
              name = "Medicine"
            },
            {
              templateId = 20004,
              quantity = 5,
              name = "Heal Grass"
            }
          },
          rawBody = "macro_AddItem(20301,5,0)\nmacro_AddItem(20302,5,0)\nmacro_AddExp(100)\nmacro_AddTongBan(100)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3276,
          mapId = 101,
          count = nil,
          monsterId = nil,
          description = "Bring Zodiac Recommendation Token to BlackSmith at the entrance to the village.",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3276,
          mapId = 101,
          count = nil,
          monsterId = nil,
          description = "Bring some \"Timberto Blacksmith from Woodman \"",
          consumeItems = {
            {
              templateId = 21116,
              quantity = 1,
              name = "Timber"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 2,
      title = "Spinning",
      startNpcId = 3276,
      minLevel = 1,
      prerequisiteTaskId = 1,
      acceptGrantItems = {
        {
          templateId = 21099,
          quantity = 1,
          name = "Blacksmith's Letter"
        }
      },
      rewards = {
        experience = 300,
        gold = 0,
        coins = 200,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 13001,
                quantity = 1,
                name = "Shoes"
              },
              {
                templateId = 10001,
                quantity = 1,
                name = "Light Hood"
              }
            }
          },
          {
            awardId = 2,
            items = {
              {
                templateId = 18001,
                quantity = 1,
                name = "Embordered Shoes"
              },
              {
                templateId = 15001,
                quantity = 1,
                name = "Red String"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 300,
          gold = nil,
          coins = 200,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 13001,
              quantity = 1,
              name = "Shoes"
            },
            {
              templateId = 10001,
              quantity = 1,
              name = "Light Hood"
            }
          },
          rawBody = "macro_AddItem(13001,1,0)\nmacro_AddItem(10001,1,0)\nmacro_AddExp(300)\nmacro_AddTongBan(200)"
        },
        {
          awardId = 2,
          experience = 300,
          gold = nil,
          coins = 200,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 18001,
              quantity = 1,
              name = "Embordered Shoes"
            },
            {
              templateId = 15001,
              quantity = 1,
              name = "Red String"
            }
          },
          rawBody = "macro_AddItem(18001,1,0)\nmacro_AddItem(15001,1,0)\nmacro_AddExp(300)\nmacro_AddTongBan(200)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3277,
          mapId = 101,
          count = nil,
          monsterId = nil,
          description = "Bring \"Blacksmith's Letter\" to \"Candy\"",
          consumeItems = {
            {
              templateId = 21099,
              quantity = 1,
              name = "Blacksmith's Letter"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "kill_collect",
          npcId = 3277,
          mapId = 101,
          count = 10,
          monsterId = nil,
          description = "Kill dragonfly to get 10 \"Dragonfly's Sting\" and bring to\"Candy\"",
          consumeItems = {
            {
              templateId = 21115,
              quantity = 10,
              name = "Dragonfly's Sting"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 3,
      title = "Magic Flask",
      startNpcId = 3023,
      minLevel = 1,
      prerequisiteTaskId = 51,
      acceptGrantItems = {},
      rewards = {
        experience = 1200,
        gold = 0,
        coins = 400,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 29001,
                quantity = 1,
                name = "Mob Flask Lv.1"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1200,
          gold = nil,
          coins = 400,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 29001,
              quantity = 1,
              name = "Mob Flask Lv.1"
            }
          },
          rawBody = "macro_AddItem(29001,1,0)\nmacro_AddItem(29001,1,1)\nmacro_AddItem(29001,1,2)\nmacro_AddExp(1200)\nmacro_AddTongBan(400)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3234,
          mapId = 102,
          count = nil,
          monsterId = nil,
          description = "Speak with \"Grocer\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "capture",
          npcId = 3234,
          mapId = 101,
          count = 1,
          monsterId = 5001,
          description = "Use \"Experimental Mob Flask\" to capture a \"Dragonfly\" and bring it to\"Grocer\"",
          consumeItems = {
            {
              templateId = 29000,
              quantity = 1,
              name = "Experimental Mob Flask"
            }
          },
          rawFlowType = "capture",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 4,
      title = "First Trial",
      startNpcId = 3234,
      minLevel = 1,
      prerequisiteTaskId = 3,
      acceptGrantItems = {
        {
          templateId = 21128,
          quantity = 1,
          name = "Brewing Bottle"
        }
      },
      rewards = {
        experience = 1500,
        gold = 0,
        coins = 500,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1500,
          gold = nil,
          coins = 500,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddTouXianNum(108)\nmacro_AddExp(1500)\nmacro_AddTongBan(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3175,
          mapId = 101,
          count = nil,
          monsterId = nil,
          description = "Bring \"Brewing Bottle\" to Shopkeeper",
          consumeItems = {
            {
              templateId = 21128,
              quantity = 1,
              name = "Brewing Bottle"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3004,
          mapId = 101,
          count = nil,
          monsterId = nil,
          description = "Bring \"Shopkeeper's Letter\" to Scholar",
          consumeItems = {
            {
              templateId = 21117,
              quantity = 1,
              name = "Shopkeeper's Letter"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3054,
          mapId = 101,
          count = nil,
          monsterId = 5119,
          description = "Speak with \"Apollo\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 4,
          type = "kill",
          npcId = 3054,
          mapId = 101,
          count = 1,
          monsterId = 5010,
          description = "Kill \"Evilelf\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 5,
      title = "Jeff the Door God",
      startNpcId = 3033,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 800,
        gold = 500,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 800,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(800)\nmacro_AddMoney(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3033,
          mapId = 112,
          count = 1,
          monsterId = 5098,
          description = "Kill \"Roaming Soul\" in Cloud City: 159.284",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 6,
      title = "Kavin the Door God",
      startNpcId = 3034,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 800,
        gold = 500,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 800,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(800)\nmacro_AddMoney(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3034,
          mapId = 112,
          count = 1,
          monsterId = 5098,
          description = "Kill \"Roaming Soul\"at night in Cloud City : 159.284",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 7,
      title = "Disenchanting",
      startNpcId = 3030,
      minLevel = 10,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21006,
          quantity = 1,
          name = "Bonnie's Pendant"
        }
      },
      rewards = {
        experience = 1200,
        gold = 0,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1200,
          gold = nil,
          coins = 1000,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(7)-macro_GetPlayerAttr(32)\nmacro_AddExp(1200)\nmacro_AddTongBan(1000)"
        }
      },
      steps = {
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3118,
          mapId = 112,
          count = nil,
          monsterId = 5503,
          description = "Bring Bonnie's \"Bonnie's Pendant\" to \"Franklin\"",
          consumeItems = {
            {
              templateId = 21006,
              quantity = 1,
              name = "Bonnie's Pendant"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3036,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Wait and speak with Bonnie at night. Quest reward: None Quest Description: Franklin seems depressed and dreamy. He may be possessed by evil spirit. Wait to find out the ghost at night. Tip: Complete \"Task 71\" ¡¡¡¡¡¡¡¡¡¡Bonnie's soul will appear at night. ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <204000><0>Previous ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <200001><0>Back",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3118,
          mapId = 112,
          count = nil,
          monsterId = 5503,
          description = "At your 14 level, go to speak with \"Franklin\" Quest reward: None Quest Description: Orchid Temple is at the north of Cloud City. There are no monks living there now. The temple is said to be haunted by ghost. A young man called Franklin came back from there the other day. It seems he is possessed by evil spirits. Please pay a visit to him. ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <204000><0>Back ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <200001><0>Previous",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 8,
      title = "Magical Adventure",
      startNpcId = 3118,
      minLevel = 14,
      prerequisiteTaskId = 7,
      acceptGrantItems = {},
      rewards = {
        experience = 4000,
        gold = 800,
        coins = 1200,
        renown = 40,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 2,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(8)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000,20))"
        },
        {
          awardId = 2,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(8)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3036,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Locate Bonnie at Orchid Temple at night. Quest reward: None Quest Description: After getting back to consciousness, Franklin told you his love story in Orchid Temple. He met Bonnie in the temple. He is just a mortal who has no magic power. He can not save Ahriman-possessed Bonnie. But he hopes that there are someone who can help him to save his beloved in Orchid Temple. Tip: Complete \"Task 7\" ¡¡¡¡¡¡¡¡¡¡Soul of Bonnie will appear at night. ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <204000><0>Previous ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <200001><0>Back",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3036,
          mapId = 163,
          count = 1,
          monsterId = 5137,
          description = "Kill \"Controlled Zombie\"-Orchid Temple",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3036,
          mapId = 163,
          count = 1,
          monsterId = 5099,
          description = "Kill \"Ahriman Lord\"-Orchid Temple(15.72)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 14,
      title = "The Forbidden Hell",
      startNpcId = 3120,
      minLevel = 24,
      prerequisiteTaskId = 12,
      acceptGrantItems = {},
      rewards = {
        experience = 8000,
        gold = 0,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 2,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(14)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*8000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*8000,20))"
        },
        {
          awardId = 2,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(14)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*8000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*8000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3120,
          mapId = 213,
          count = 1,
          monsterId = 5104,
          description = "Kill \"Kobold\"at the hell gate-Judgement Hall(102.152)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 16,
      title = "Giant Willow",
      startNpcId = 3218,
      minLevel = 24,
      prerequisiteTaskId = 82,
      acceptGrantItems = {},
      rewards = {
        experience = 20000,
        gold = 2000,
        coins = 3000,
        renown = 80,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "Item={1,2,101,102,103,104,105,106,107,108}\niTemp=28+macro_GetTaskLevelFromAll(16)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*20000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*20000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3218,
          mapId = 146,
          count = 1,
          monsterId = 5039,
          description = "Kill \"Giant Willow\"£­Willow Forest(32.473)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 17,
      title = "Giant Peach",
      startNpcId = 3218,
      minLevel = 24,
      prerequisiteTaskId = 16,
      acceptGrantItems = {},
      rewards = {
        experience = 20000,
        gold = 3000,
        coins = 3000,
        renown = 80,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "Item={1,2,101,102,103,104,105,106,107,108}\niTemp=28+macro_GetTaskLevelFromAll(17)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*20000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*20000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3218,
          mapId = 146,
          count = 1,
          monsterId = 5040,
          description = "Kill \"Giant Peach\"£­Willow Forest(228.46)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 18,
      title = "Old Friend",
      startNpcId = 3162,
      minLevel = 20,
      prerequisiteTaskId = 36,
      acceptGrantItems = {},
      rewards = {
        experience = 3000,
        gold = 800,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(18)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*3000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*3000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3162,
          mapId = 120,
          count = 1,
          monsterId = 5059,
          description = "Kill vicious \"Spider Overlord\"£­Cobweb Woods(60.229)",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3042,
          mapId = 120,
          count = nil,
          monsterId = nil,
          description = "Tell Flap-eared Pig that Geralyn has returned safely.",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3162,
          mapId = 131,
          count = nil,
          monsterId = nil,
          description = "Bring \"Transformed Cabbage\" to Geralyn",
          consumeItems = {
            {
              templateId = 21101,
              quantity = 1,
              name = "Transformed Cabbage"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 19,
      title = "Evil Spider",
      startNpcId = 3042,
      minLevel = 20,
      prerequisiteTaskId = 81,
      acceptGrantItems = {},
      rewards = {
        experience = 4500,
        gold = 1600,
        coins = 2000,
        renown = 100,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 4500,
          gold = 1600,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(4500)\nmacro_AddMoney(1600)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3042,
          mapId = 131,
          count = 1,
          monsterId = 5043,
          description = "Kill \"Evil Spider\"-Cobweb Woods (51.86)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 20,
      title = "Thief Catcher",
      startNpcId = 3022,
      minLevel = 18,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 23045,
                quantity = 1,
                name = "Jade Fragment"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 23045,
              quantity = 1,
              name = "Jade Fragment"
            }
          },
          rawBody = "macro_AddItem(23045,1,0)\niTemp=28+macro_GetTaskLevelFromAll(20)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*2000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*2000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3163,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring Commander's Proof to \"General White\"",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 21,
      title = "Everyboies Wish",
      startNpcId = 3229,
      minLevel = 18,
      prerequisiteTaskId = 35,
      acceptGrantItems = {},
      rewards = {
        experience = 2000,
        gold = 0,
        coins = 1500,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 26015,
                quantity = 3,
                name = "Equipment Treasure Map (Primary"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 26015,
              quantity = 3,
              name = "Equipment Treasure Map (Primary"
            }
          },
          rawBody = "macro_AddItem(26015,3,0)\niTemp=28+macro_GetTaskLevelFromAll(21)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*8000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*8000,20))"
        }
      },
      steps = {
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3230,
          mapId = 230,
          count = 1,
          monsterId = 5022,
          description = "Kill \"Lord Glenn\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 29,
      title = "Illness Beadroll",
      startNpcId = 3220,
      minLevel = 38,
      prerequisiteTaskId = 28,
      acceptGrantItems = {
        {
          templateId = 21140,
          quantity = 1,
          name = "Broken Tome 1"
        }
      },
      rewards = {
        experience = 200000,
        gold = 2000,
        coins = 5000,
        renown = 160,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(29)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*200000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*200000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3220,
          mapId = 231,
          count = nil,
          monsterId = 5145,
          description = "Kill \"Hoe Ghost\" to obtain \"Broken Tome 1\" .Then take it to Smith",
          consumeItems = {
            {
              templateId = 21140,
              quantity = 1,
              name = "Broken Tome 1"
            }
          },
          rawFlowType = "kill_collect"
        },
        {
          stepIndex = 2,
          type = "kill_collect",
          npcId = 3220,
          mapId = 231,
          count = nil,
          monsterId = 5157,
          description = "Kill \"Muscular Nowt\" and obtain \"Broken Tome 2\" .Then bring it to Smith",
          consumeItems = {
            {
              templateId = 21141,
              quantity = 1,
              name = "Broken Tome 2"
            }
          },
          rawFlowType = "kill_collect"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3053,
          mapId = 231,
          count = nil,
          monsterId = nil,
          description = "Get \"Complete Tome\" and bring it to Fiend of Plague",
          consumeItems = {
            {
              templateId = 21142,
              quantity = 1,
              name = "Complete Tome"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 4,
          type = "talk",
          npcId = 3044,
          mapId = 214,
          count = nil,
          monsterId = nil,
          description = "Bring \"Royal Sword\" and \"Elixir by Fiend of Plague\" to General Lee",
          consumeItems = {
            {
              templateId = 21019,
              quantity = 1,
              name = "Royal Sword"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 30,
      title = "Birth of Nalory",
      startNpcId = 3098,
      minLevel = 40,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21041,
          quantity = 1,
          name = "Jadeware"
        }
      },
      rewards = {
        experience = 20000,
        gold = 0,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 24121,
                quantity = 1,
                name = "Guild Resource Bag"
              },
              {
                templateId = 24142,
                quantity = 1,
                name = "Adv. Position Stone Bag"
              },
              {
                templateId = 24144,
                quantity = 1,
                name = "Sapphire Key"
              }
            }
          },
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 24121,
              quantity = 1,
              name = "Guild Resource Bag"
            },
            {
              templateId = 24142,
              quantity = 1,
              name = "Adv. Position Stone Bag"
            },
            {
              templateId = 24144,
              quantity = 1,
              name = "Sapphire Key"
            }
          },
          rawBody = "macro_AddExp(lv*2000)\nmacro_AddMoney(lv*50)\nmacro_AddRp(lv*3)\n\na=macro_Rand(100)\n\tif(a<40)then\n\tmacro_AddItemBangDing(24121,1,0)\t\n\telseif(a<65)then\n\tmacro_AddItemBangDing(24142,1,0)\n\telse\n\tmacro_AddItemBangDing(24144,1,0)"
        },
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(782)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*20000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*20000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3044,
          mapId = 164,
          count = nil,
          monsterId = nil,
          description = "Bring Jadeware to General Lee",
          consumeItems = {
            {
              templateId = 21041,
              quantity = 1,
              name = "Jadeware"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 32,
      title = "Cosmos Spook",
      startNpcId = 3033,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1200,
        gold = 2000,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 5102,
                quantity = 1,
                name = "Treasures Club"
              },
              {
                templateId = 5103,
                quantity = 1,
                name = "Purple Club"
              },
              {
                templateId = 5104,
                quantity = 1,
                name = "Emerald Club"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1200,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 5102,
              quantity = 1,
              name = "Treasures Club"
            },
            {
              templateId = 5103,
              quantity = 1,
              name = "Purple Club"
            },
            {
              templateId = 5104,
              quantity = 1,
              name = "Emerald Club"
            }
          },
          rawBody = "macro_AddTouXianNum(109)\nmacro_AddExp(1200)\nmacro_AddItem(5102,1,0)\nelseif(award==2)then\nmacro_AddItem(5103,1,0)\nmacro_AddTouXianNum(109)\nmacro_AddExp(1200)\nelse\nmacro_AddItem(5104,1,0)\nmacro_AddTouXianNum(109)\nmacro_AddExp(1200)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3033,
          mapId = 112,
          count = 1,
          monsterId = 5013,
          description = "Kill \"Cosmos Spook\" in Cloud City(63.437)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 33,
      title = "Lingering Fantom",
      startNpcId = 3034,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1200,
        gold = 2000,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 5102,
                quantity = 1,
                name = "Treasures Club"
              },
              {
                templateId = 5103,
                quantity = 1,
                name = "Purple Club"
              },
              {
                templateId = 5104,
                quantity = 1,
                name = "Emerald Club"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1200,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 5102,
              quantity = 1,
              name = "Treasures Club"
            },
            {
              templateId = 5103,
              quantity = 1,
              name = "Purple Club"
            },
            {
              templateId = 5104,
              quantity = 1,
              name = "Emerald Club"
            }
          },
          rawBody = "macro_AddTouXianNum(109)\nmacro_AddExp(1200)\nmacro_AddItem(5102,1,0)\nelseif(award==2)then\nmacro_AddTouXianNum(109)\nmacro_AddExp(1200)\nmacro_AddItem(5103,1,0)\nelse\nmacro_AddTouXianNum(109)\nmacro_AddExp(1200)\nmacro_AddItem(5104,1,0)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3034,
          mapId = 112,
          count = 1,
          monsterId = 5014,
          description = "Kill \"Lingering Phantom\" in Cloud City: 7.292",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 34,
      title = "The Comeback",
      startNpcId = 3036,
      minLevel = 14,
      prerequisiteTaskId = 8,
      acceptGrantItems = {
        {
          templateId = 21007,
          quantity = 1,
          name = "Forgotten Pendant"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3118,
          mapId = 163,
          count = nil,
          monsterId = nil,
          description = "Bring Bonnie's \"Forgotten Pendant\" to Franklin",
          consumeItems = {
            {
              templateId = 21007,
              quantity = 1,
              name = "Forgotten Pendant"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3022,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Ar you 18 level, go to speak with \"Commander\" Quest reward: Experience: 2000 Gold: 400 Coin: 800 Item: \"Bonnie's Pendant\" Quest Description: After getting back to consciousness, Franklin told you his love story in Orchid Temple. He met Bonnie in the temple. He is just a mortal who has no magic power. He can not save Ahriman-possessed Bonnie. But he hopes that there are someone who can help him to save his beloved in Orchid Temple. Tip: Complete \"Task 7\" ¡¡¡¡¡¡¡¡¡¡Soul of Bonnie will appear at night. ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <204000><0>Previous ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <200001><0>Back",
          consumeItems = {
            {
              templateId = 8011,
              quantity = 1,
              name = "Bonnie's Pendant"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 0,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 36,
      title = "Goal Manor Immortal",
      startNpcId = 3022,
      minLevel = 18,
      prerequisiteTaskId = 21,
      acceptGrantItems = {},
      rewards = {
        experience = 2000,
        gold = 0,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 2,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(36)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*2000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*2000,20))"
        },
        {
          awardId = 2,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(36)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*2000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*2000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3022,
          mapId = 112,
          count = 1,
          monsterId = 5158,
          description = "Travel to\"Map 144\" and capture \"Patrolman of Darkness\"",
          consumeItems = {},
          rawFlowType = "capture"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3042,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "At your 20 level, travel to \"Map 131\" to speak with \"Flap-eared Pig\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3042,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Commander\"'s \"Letter of Request\" to \"Flap-eared Pig\"",
          consumeItems = {
            {
              templateId = 21016,
              quantity = 1,
              name = "Letter of Request"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3162,
          mapId = 131,
          count = nil,
          monsterId = nil,
          description = "Travel to \"Map 120\" and locate \"Geralyn\"",
          consumeItems = {
            {
              templateId = 12102,
              quantity = 1,
              name = "Universal Belt"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 37,
      title = "Bad News",
      startNpcId = 3042,
      minLevel = 20,
      prerequisiteTaskId = 19,
      acceptGrantItems = {
        {
          templateId = 21133,
          quantity = 1,
          name = "Monster Information"
        }
      },
      rewards = {
        experience = 500,
        gold = 500,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 500,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(500)\nmacro_AddMoney(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3042,
          mapId = 131,
          count = nil,
          monsterId = nil,
          description = "Bring Badly-wounded Soldier's \"Monster Information\" to Flap-eared Pig",
          consumeItems = {
            {
              templateId = 21133,
              quantity = 1,
              name = "Monster Information"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3218,
          mapId = 131,
          count = nil,
          monsterId = nil,
          description = "At your 24 Level, go to speak with Maple Valley Spirit",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 38,
      title = "Perfection",
      startNpcId = 3218,
      minLevel = 24,
      prerequisiteTaskId = 17,
      acceptGrantItems = {
        {
          templateId = 21152,
          quantity = 1,
          name = "Rune"
        }
      },
      rewards = {
        experience = 1200,
        gold = 600,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 2,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(38)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*1200,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*1200,20))"
        },
        {
          awardId = 2,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(38)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*1200,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*1200,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3044,
          mapId = 146,
          count = nil,
          monsterId = nil,
          description = "At your 32 level, bring \"Rune\" to \"General Lee\"",
          consumeItems = {
            {
              templateId = 21152,
              quantity = 1,
              name = "Rune"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 39,
      title = "Demon Party",
      startNpcId = 3092,
      minLevel = 32,
      prerequisiteTaskId = 27,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(39)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*150000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*150000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3044,
          mapId = 144,
          count = nil,
          monsterId = nil,
          description = "At your 35 level, go to speak with \"General Lee\" in Chill Pass",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 41,
      title = "Lonely Ghost King",
      startNpcId = 3033,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 2400,
        gold = 500,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 11102,
                quantity = 1,
                name = "Universal Armor"
              }
            }
          },
          {
            awardId = 2,
            items = {
              {
                templateId = 16102,
                quantity = 1,
                name = "Mesh Robe"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 2400,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 11102,
              quantity = 1,
              name = "Universal Armor"
            }
          },
          rawBody = "macro_AddItem(11102,1,0)\nmacro_AddExp(2400)\nmacro_AddMoney(500)"
        },
        {
          awardId = 2,
          experience = 2400,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 16102,
              quantity = 1,
              name = "Mesh Robe"
            }
          },
          rawBody = "macro_AddItem(16102,1,0)\nmacro_AddExp(2400)\nmacro_AddMoney(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3033,
          mapId = 112,
          count = 1,
          monsterId = 5007,
          description = "Kill \"Lonely Ghost King\" in Cloud City",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 42,
      title = "Wild Ghost King",
      startNpcId = 3034,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 2400,
        gold = 500,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 11102,
                quantity = 1,
                name = "Universal Armor"
              }
            }
          },
          {
            awardId = 2,
            items = {
              {
                templateId = 16102,
                quantity = 1,
                name = "Mesh Robe"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 2400,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 11102,
              quantity = 1,
              name = "Universal Armor"
            }
          },
          rawBody = "macro_AddItem(11102,1,0)\nmacro_AddExp(2400)\nmacro_AddMoney(500)"
        },
        {
          awardId = 2,
          experience = 2400,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 16102,
              quantity = 1,
              name = "Mesh Robe"
            }
          },
          rawBody = "macro_AddItem(16102,1,0)\nmacro_AddExp(2400)\nmacro_AddMoney(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3034,
          mapId = 112,
          count = 1,
          monsterId = 5008,
          description = "Kill \"Wild Ghost King\" at Cloudy City:196.466",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 44,
      title = "Mentor's Care",
      startNpcId = 3098,
      minLevel = 45,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21144,
          quantity = 1,
          name = "Supreme Taoist's Letter"
        }
      },
      rewards = {
        experience = 50000,
        gold = 2000,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(44)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*50000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*50000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3138,
          mapId = 164,
          count = nil,
          monsterId = 5148,
          description = "Bring \"Supreme Taoist's Letter\" to \"Evil Cat\"",
          consumeItems = {
            {
              templateId = 21144,
              quantity = 1,
              name = "Supreme Taoist's Letter"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 51,
      title = "Pet",
      startNpcId = 3277,
      minLevel = 1,
      prerequisiteTaskId = 2,
      acceptGrantItems = {},
      rewards = {
        experience = 1000,
        gold = 0,
        coins = 300,
        renown = 0,
        pets = {
          "i"
        },
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 26036,
                quantity = 1,
                name = "Ordinary Treasure Map (Primary)"
              }
            }
          },
          {
            awardId = 1,
            items = {
              {
                templateId = 26036,
                quantity = 1,
                name = "Ordinary Treasure Map (Primary)"
              },
              {
                templateId = 26036,
                quantity = 3,
                name = "Ordinary Treasure Map (Primary)"
              }
            }
          },
          {
            awardId = 1,
            items = {
              {
                templateId = 26036,
                quantity = 3,
                name = "Ordinary Treasure Map (Primary)"
              }
            }
          },
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 26036,
              quantity = 1,
              name = "Ordinary Treasure Map (Primary)"
            }
          },
          rawBody = "getrand=macro_Rand(2)\n\tif(getrand==0)then\n\t\titem={101,102,103,104,105,106,107,108,1,2}\n\t\tx=macro_Rand(10)+1\n\t\tmacro_AddItem(item[x],1,0)--Áé»ê±¦Öé\n\telse\n\t\tmacro_AddItem(26036,1,0)--²Ø±¦Í¼"
        },
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 26036,
              quantity = 1,
              name = "Ordinary Treasure Map (Primary)"
            },
            {
              templateId = 26036,
              quantity = 3,
              name = "Ordinary Treasure Map (Primary)"
            }
          },
          rawBody = "getrand1=macro_Rand(2)\n\tif(getrand1==0)then\n\t\titem={101,102,103,104,105,106,107,108,1,2}\n\t\tx=macro_Rand(10)+1\n\t\tmacro_AddItem(item[x],1,0)--Áé»ê±¦Öé\n\telseif(getrand1==1)then\n\t\tgetrand2=macro_Rand(2)\n\t\tif(getrand2==0)then\n\t\tmacro_AddItem(26036,1,0)--²Ø±¦Í¼\n\t\telseif(getrand2==1)then\n\t\tmacro_AddItem(26036,3,0)"
        },
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 26036,
              quantity = 3,
              name = "Ordinary Treasure Map (Primary)"
            }
          },
          rawBody = "getrand=macro_Rand(2)\n\tif(getrand==0)then\n\t\titem={101,102,103,104,105,106,107,108,1,2}\n\t\tx=macro_Rand(10)+1\n\t\tmacro_AddItem(item[x],1,0)--Áé»ê±¦Öé\n\telse\n\t\tmacro_AddItem(26036,3,0)--²Ø±¦Í¼"
        },
        {
          awardId = 1,
          experience = 1000,
          gold = 1000,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(1000)\n\t\tmacro_AddMoney(1000)\n\t\tif(iTemp==9)then\n\t\t\titem={11200,11201,11202,16200,16201,16202,}\n\t\t\tiRand=macro_Rand(6)+1\n\t\t\tmacro_AddItem(item[iRand],1,0)"
        },
        {
          awardId = 1,
          experience = 1000,
          gold = nil,
          coins = 300,
          renown = nil,
          petTemplateIds = {
            "i"
          },
          items = {},
          rawBody = "i=macro_GetPlayerAttr(30)\ni=2000+i\nmacro_AddPet(i)\nmacro_AddExp(1000)\nmacro_AddTongBan(300)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3004,
          mapId = 101,
          count = nil,
          monsterId = nil,
          description = "Speak with\"Scholar\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3005,
          mapId = 101,
          count = nil,
          monsterId = nil,
          description = "Bring \"Scholar's Letter\" to \"Idler\"",
          consumeItems = {
            {
              templateId = 21001,
              quantity = 1,
              name = "Scholar's Letter"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3023,
          mapId = 101,
          count = nil,
          monsterId = nil,
          description = "Bring \"Special Wine\" to \"Grandpa\"",
          consumeItems = {
            {
              templateId = 21124,
              quantity = 1,
              name = "Special Wine"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 4,
          type = "kill",
          npcId = 3023,
          mapId = 103,
          count = 1,
          monsterId = 5003,
          description = "Kill \"Little Boar\" \"Map 103\"£º\" \".\" \"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 52,
      title = "Dementor",
      startNpcId = 3155,
      minLevel = 68,
      prerequisiteTaskId = 49,
      acceptGrantItems = {
        {
          templateId = 21176,
          quantity = 1,
          name = "Soul Absorber's Memory"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(52)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*2000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*2000000,20))"
        }
      },
      steps = {
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3138,
          mapId = 249,
          count = nil,
          monsterId = 5148,
          description = "Take \"Soul Absorber's Memory\" to find \"Evil Cat\"",
          consumeItems = {
            {
              templateId = 21176,
              quantity = 1,
              name = "Soul Absorber's Memory"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 57,
      title = "Headless Ripper",
      startNpcId = 3155,
      minLevel = 68,
      prerequisiteTaskId = 52,
      acceptGrantItems = {
        {
          templateId = 21177,
          quantity = 1,
          name = "Soul of Soul Absorber"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(57)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))"
        }
      },
      steps = {
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3187,
          mapId = 213,
          count = nil,
          monsterId = nil,
          description = "Bring \"Soul of Soul Absorber\" to\"Night Owl\"",
          consumeItems = {
            {
              templateId = 21177,
              quantity = 1,
              name = "Soul of Soul Absorber"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 58,
      title = "Farewell to Jessica",
      startNpcId = 3120,
      minLevel = 68,
      prerequisiteTaskId = 57,
      acceptGrantItems = {},
      rewards = {
        experience = 20000,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 20000,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(20000)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3135,
          mapId = 213,
          count = nil,
          monsterId = nil,
          description = "At your 70 Level, go to speak with \"Governor\" Quest Description:With the help of Zodiac Eudemon, you have successfully run out of the gate. But from Night Owl and Soul Judge's face told you that something unexpected happened. Go to check on Jessica at the Governor's. She may need your help. ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <210000><0>Previous ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <200001><0>Back",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 59,
      title = "Punishment",
      startNpcId = 3492,
      minLevel = 74,
      prerequisiteTaskId = 69,
      acceptGrantItems = {},
      rewards = {
        experience = 400000,
        gold = 30000,
        coins = 20000,
        renown = 300,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 400000,
          gold = 30000,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(400000)\nmacro_AddMoney(30000)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3426,
          mapId = 182,
          count = nil,
          monsterId = nil,
          description = "At your 80 Level, go to speak with \"Village Head\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3452,
          mapId = 170,
          count = nil,
          monsterId = nil,
          description = "Bring \"Village Head\"'s \"Stone of Remorse\" to \"Lake Spirit\"",
          consumeItems = {
            {
              templateId = 21286,
              quantity = 1,
              name = "Stone of Remorse"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3452,
          mapId = 181,
          count = 1,
          monsterId = 5299,
          description = "Kill \"Cepheus\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 60,
      title = "Anxious Thunder God",
      startNpcId = 3452,
      minLevel = 78,
      prerequisiteTaskId = 59,
      acceptGrantItems = {},
      rewards = {
        experience = 10000000,
        gold = 10000,
        coins = 20000,
        renown = 300,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(60)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*10000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3453,
          mapId = 181,
          count = nil,
          monsterId = 5576,
          description = "At your 82 level, go to Lotus Peak to speak with \"Thunder God\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3453,
          mapId = 165,
          count = 1,
          monsterId = 5301,
          description = "Kill \"Roaring Dog\" and save Jerry",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 3,
          type = "kill",
          npcId = 3453,
          mapId = 165,
          count = 1,
          monsterId = 5304,
          description = "Speak with \"Jerry\" and kill \"Jerry\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 61,
      title = "Underground Hall",
      startNpcId = 3453,
      minLevel = 82,
      prerequisiteTaskId = 60,
      acceptGrantItems = {},
      rewards = {
        experience = 15000000,
        gold = 30000,
        coins = 20000,
        renown = 400,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(61)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*15000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3097,
          mapId = 165,
          count = nil,
          monsterId = 5111,
          description = "Travel to \"Map 279\" to speak with \"Lakery\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3097,
          mapId = 279,
          count = 1,
          monsterId = 5471,
          description = "Kill \"White Elephant Spirit\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3452,
          mapId = 279,
          count = nil,
          monsterId = nil,
          description = "Bring \"Moon Lake Symbol\" to \"Lake Spirit\"",
          consumeItems = {
            {
              templateId = 21289,
              quantity = 1,
              name = "Moon Lake Symbol"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 65,
      title = "Skull Goblin",
      startNpcId = 3097,
      minLevel = 82,
      prerequisiteTaskId = 61,
      acceptGrantItems = {},
      rewards = {
        experience = 12000000,
        gold = 20000,
        coins = 40000,
        renown = 300,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(65)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3454,
          mapId = 181,
          count = nil,
          monsterId = nil,
          description = "At your 86 level, travel to \"Map 161\" to speak with \"Grandpa\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3454,
          mapId = 161,
          count = nil,
          monsterId = nil,
          description = "Find Grandpa's Daughter in Soul-free Valley and back to Grandpa",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3454,
          mapId = 161,
          count = nil,
          monsterId = nil,
          description = "Find Grandpa's Fere in Soul-free Valley and back to Grandpa",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 4,
          type = "talk",
          npcId = 3457,
          mapId = 161,
          count = nil,
          monsterId = nil,
          description = "Speak with \"Grandpa\" and after his quest, speak with \"Soul-wander Valley Spirit\"",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 67,
      title = "Adversary",
      startNpcId = 3211,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 2600,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(67)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*12000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*12000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3211,
          mapId = 263,
          count = nil,
          monsterId = nil,
          description = "Bring \"..macro_GetItemName()..\" to \"Jessica\"",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 69,
      title = "Giant Icicles",
      startNpcId = 3529,
      minLevel = 70,
      prerequisiteTaskId = 58,
      acceptGrantItems = {},
      rewards = {
        experience = 75000,
        gold = 4310,
        coins = 10000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 75000,
          gold = 4310,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(75000)\nmacro_AddMoney(4310)"
        },
        {
          awardId = 1,
          experience = 66000,
          gold = 5035,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(66000)\nmacro_AddMoney(5035)"
        },
        {
          awardId = 1,
          experience = 54000,
          gold = 4068,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(54000)\nmacro_AddMoney(4068)"
        },
        {
          awardId = 1,
          experience = 42000,
          gold = 3860,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(42000)\nmacro_AddMoney(3860)"
        },
        {
          awardId = 1,
          experience = 36000,
          gold = 3420,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(36000)\nmacro_AddMoney(3420)"
        },
        {
          awardId = 1,
          experience = 30000,
          gold = 4156,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(30000)\nmacro_AddMoney(4156)"
        },
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(69)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*1000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*1000000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3492,
          mapId = 166,
          count = nil,
          monsterId = 5507,
          description = "At your 76 Level, speak with \"Melody\" in Loneness Mountain",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3492,
          mapId = 182,
          count = 1,
          monsterId = 5470,
          description = "Kill \"Ice Soul\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 70,
      title = "Apprenticeship",
      startNpcId = 3022,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21034,
          quantity = 1,
          name = "Commander's Letter"
        }
      },
      rewards = {
        experience = 1500,
        gold = 500,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 1,
            items = {
              {
                templateId = 5102,
                quantity = 1,
                name = "Treasures Club"
              }
            }
          },
          {
            awardId = 2,
            items = {
              {
                templateId = 5103,
                quantity = 1,
                name = "Purple Club"
              }
            }
          },
          {
            awardId = 3,
            items = {
              {
                templateId = 5104,
                quantity = 1,
                name = "Emerald Club"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 560,
          gold = 712,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(560)\nmacro_AddMoney(712)\n\n\nmaxnum=4\ngailv={40,65,90,100}\nitemnum={{1,20023,},\n{1,26004},\n{27,5011,5012,5013,10100,10101,10102,15100,15101,15102,11100,11101,11102,16100,16101,16102,12100,12101,12103,17100,17101,17102,13100,13101,13102,18100,18101,18102},\n{27,5014,5015,5016,10103,10104,10105,15103,15104,15105,11103,11104,11105,16103,16104,16107,12104,12105,12106,17103,17104,17105,13103,13104,13105,18103,18104,18105},\n}\n\nfunction mainfun()\nfor i=1,maxnum,1 do\nxx=macro_Rand(100)\nif(xx<gailv[i])then\n  randnum=macro_Rand(itemnum[i][1])+2\n  macro_AddItem(itemnum[i][randnum],1,0)\n  return"
        },
        {
          awardId = 1,
          experience = 1500,
          gold = 500,
          coins = 1000,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 5102,
              quantity = 1,
              name = "Treasures Club"
            }
          },
          rawBody = "macro_AddItem(5102,1,0)\nmacro_AddExp(1500)\nmacro_AddMoney(500)\nmacro_AddTongBan(1000)"
        },
        {
          awardId = 2,
          experience = 1500,
          gold = 500,
          coins = 1000,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 5103,
              quantity = 1,
              name = "Purple Club"
            }
          },
          rawBody = "macro_AddItem(5103,1,0)\nmacro_AddExp(1500)\nmacro_AddMoney(500)\nmacro_AddTongBan(1000)"
        },
        {
          awardId = 3,
          experience = 1500,
          gold = 500,
          coins = 1000,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 5104,
              quantity = 1,
              name = "Emerald Club"
            }
          },
          rawBody = "macro_AddItem(5104,1,0)\nmacro_AddExp(1500)\nmacro_AddMoney(500)\nmacro_AddTongBan(1000)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3080,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Commander's Letter\" to \"Freddie\"",
          consumeItems = {
            {
              templateId = 21034,
              quantity = 1,
              name = "Commander's Letter"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3089,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Speak with \"Housewife\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3110,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Speak with \"M/A Manager\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 4,
          type = "kill",
          npcId = 3110,
          mapId = 112,
          count = 1,
          monsterId = 5036,
          description = "Kill \"Lizard\"¡Á10",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 71,
      title = "Knowing your ways around",
      startNpcId = 3110,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21102,
          quantity = 1,
          name = "Letter of M/A Manager"
        }
      },
      rewards = {
        experience = 3300,
        gold = 800,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 3300,
          gold = 800,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(3300)\nmacro_AddMoney(800)\n\n\nmaxnum=11\ngailv={150,250,350,450,550,700,830,930,980,1000}--¸ÅÂÊ\n--¿ÉËæµÀ¾ßµÄ¸öÊý£¬ËÍµÄµÀ¾ßµÄ¸öÊý£¬ºÍµÀ¾ßID¡£¡£¡£\nitem={\n{1,1,20006},\n{1,2,20006},\n{1,1,20003},\n{1,2,26003,},\n{1,1,20018},\n{1,2,20018},\n{1,1,20019},\n{1,2,20019},\n{27,1,5038,5039,5040,10400,10401,10402,15400,15401,15402,11400,11401,11402,16400,16401,16402,12400,12401,12403,17400,17401,17402,13400,13401,13402,18400,18401,18402},\n{27,1,5041,5042,5043,10403,10404,10405,15403,15404,15405,11403,11404,11405,16403,16404,16405,12403,12404,12405,17403,17404,17405,13403,13404,13405,18403,18404,18405},\n{27,5044,5045,5046,10406,10407,10408,15406,15407,15408,11406,11407,11408,16406,16407,16408,12406,12407,12408,17406,17407,17408,13406,13407,13408,18406,18407,18408},\n\n\n}\n--¿ÉËæµÀ¾ßµÄ¸öÊý£¬ËÍµÄµÀ¾ßµÄ¸öÊý£¬ºÍµÀ¾ßID¡£¡£¡£\n\n\nfunction mainfun()\nx=macro_Rand(1000)\nfor i=1,maxnum,1 do\nif(x<gailv[i])then\n  randnum=macro_Rand(item[i][1])+3\n  macro_AddItem(item[i][randnum],item[i][2],0)\n  return"
        },
        {
          awardId = 1,
          experience = 1000,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(1000)\nmacro_AddMoney(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3013,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Letter of M/A Manager\" to \"Pet Curer\"",
          consumeItems = {
            {
              templateId = 21102,
              quantity = 1,
              name = "Letter of M/A Manager"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3025,
          mapId = 228,
          count = nil,
          monsterId = nil,
          description = "Travel to East Gate to speak with \"Corey\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3118,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 81,
      title = "Geralyn",
      startNpcId = 3305,
      minLevel = 20,
      prerequisiteTaskId = 18,
      acceptGrantItems = {},
      rewards = {
        experience = 6000,
        gold = 1500,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 2,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(81)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*6000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*6000,20))"
        },
        {
          awardId = 2,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(81)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*6000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*6000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3162,
          mapId = 264,
          count = nil,
          monsterId = nil,
          description = "Travel to \"Map 120\" to liberate \"Geralyn\"",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3042,
          mapId = 120,
          count = nil,
          monsterId = nil,
          description = "Escort \"Geralyn\" to Goal Manor to meet \"Flap-eared Pig\"",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3042,
          mapId = 131,
          count = nil,
          monsterId = nil,
          description = "Bring Flap-eared Pig's Rubble to find out spider sprite in human skin in the manor",
          consumeItems = {
            {
              templateId = 11102,
              quantity = 1,
              name = "Universal Armor"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 82,
      title = "Flaming Hell",
      startNpcId = 3120,
      minLevel = 24,
      prerequisiteTaskId = 14,
      acceptGrantItems = {},
      rewards = {
        experience = 8000,
        gold = 0,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          },
          {
            awardId = 2,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(82)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*8000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*8000,20))"
        },
        {
          awardId = 2,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(82)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*8000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*8000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3160,
          mapId = 213,
          count = nil,
          monsterId = nil,
          description = "Travel to \"Map 156\" and speak with \"Peter\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3218,
          mapId = 156,
          count = nil,
          monsterId = nil,
          description = "Bring \"Rune of Seal\" to Maple Valley Spirit",
          consumeItems = {
            {
              templateId = 21013,
              quantity = 1,
              name = "Rune of Seal"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 84,
      title = "Unexpected War",
      startNpcId = 3457,
      minLevel = 86,
      prerequisiteTaskId = 65,
      acceptGrantItems = {},
      rewards = {
        experience = 1000000,
        gold = 2000,
        coins = 20000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(84)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*1000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*1000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*1000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3414,
          mapId = 161,
          count = nil,
          monsterId = nil,
          description = "At your 90 level, go to speak with \"Norman\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3751,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "Travel to \"Map 210\" to speak with \"God of Venus\"",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 85,
      title = "West Pass War",
      startNpcId = 3751,
      minLevel = 90,
      prerequisiteTaskId = 84,
      acceptGrantItems = {},
      rewards = {
        experience = 16000000,
        gold = 20000,
        coins = 60000,
        renown = 300,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(85)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3751,
          mapId = 210,
          count = nil,
          monsterId = 5583,
          description = "Defeat \"Shadow Bear\" with Nalory",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3751,
          mapId = 210,
          count = nil,
          monsterId = 21383,
          description = "Find the point and stick flag at the coordinates, you will get \"Npc 21383\" .Then bring \"Npc 21383\" to \"God of Venus\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "kill",
          npcId = 3751,
          mapId = 210,
          count = 1,
          monsterId = 5584,
          description = "Kill \"Taoist\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 4,
          type = "kill",
          npcId = 3751,
          mapId = 210,
          count = 1,
          monsterId = 5584,
          description = "Kill \"Taoist\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 86,
      title = "North Pass War",
      startNpcId = 3751,
      minLevel = 90,
      prerequisiteTaskId = 85,
      acceptGrantItems = {},
      rewards = {
        experience = 18000000,
        gold = 20000,
        coins = 60000,
        renown = 300,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(86)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*3000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*3000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*3000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3751,
          mapId = 210,
          count = nil,
          monsterId = nil,
          description = "At your 92 level, go to speak with \"God of Venus\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3754,
          mapId = 210,
          count = nil,
          monsterId = 5122,
          description = "Speak with \"Nalory\" at front line",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "kill",
          npcId = 3754,
          mapId = 212,
          count = 1,
          monsterId = 5585,
          description = "Kill \"Thunder Beast\" ºÍ \"Lightning Beast\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 4,
          type = "talk",
          npcId = 3751,
          mapId = 212,
          count = nil,
          monsterId = nil,
          description = "Speak with \"God of Venus\"",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 87,
      title = "Cheering Duo",
      startNpcId = 3751,
      minLevel = 92,
      prerequisiteTaskId = 86,
      acceptGrantItems = {},
      rewards = {
        experience = 20000000,
        gold = 20000,
        coins = 60000,
        renown = 300,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(87)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3754,
          mapId = 210,
          count = nil,
          monsterId = 5122,
          description = "At your 94 level, go to speak with \"Nalory\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3754,
          mapId = 212,
          count = nil,
          monsterId = 5587,
          description = "Disguise in bandit and go to speak with East Gate Guard. Bring the Pulque to \"East Cheerleader\" . Then defeat him.",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3764,
          mapId = 212,
          count = nil,
          monsterId = 5588,
          description = "Disguise as a bandit again and speak with West Gate Guard. Then locate and speak with \"West Cheerleader\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 4,
          type = "kill",
          npcId = 3764,
          mapId = 212,
          count = 1,
          monsterId = 5588,
          description = "Kill \"West Cheerleader\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 88,
      title = "Hell Pass Adventure",
      startNpcId = 3771,
      minLevel = 94,
      prerequisiteTaskId = 87,
      acceptGrantItems = {},
      rewards = {
        experience = 20000000,
        gold = 20000,
        coins = 60000,
        renown = 300,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(88)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))\n\tmacro_AddExp(macro_Chu(2*5000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3773,
          mapId = 212,
          count = nil,
          monsterId = nil,
          description = "At your 96 level, travel to \"Map 212\" to speak with \"Granny\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3751,
          mapId = 212,
          count = nil,
          monsterId = nil,
          description = "Speak with \"God of Venus\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3774,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "Speak with \"Triumph Sprite\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 4,
          type = "kill",
          npcId = 3774,
          mapId = 130,
          count = 1,
          monsterId = 5589,
          description = "Kill \"Hell Keeper\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 251,
      title = "The Mission",
      startNpcId = 3022,
      minLevel = 25,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 5000,
        gold = 1000,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 5000,
          gold = 1000,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(5000)\nmacro_AddMoney(1000)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3183,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Speak with \"Jasmin\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3183,
          mapId = 112,
          count = 1,
          monsterId = 5158,
          description = "Travel to \"Map 145\" to capture one \"Patrolman of Darkness\" . Get monster's latest news from him.",
          consumeItems = {},
          rawFlowType = "capture"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3224,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Speak with \"Mike\"",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 252,
      title = "The Power",
      startNpcId = 3224,
      minLevel = 25,
      prerequisiteTaskId = 251,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "if(macro_GetTaskHistoryLevel(257)<0)then\n\tif(macro_GetSex()==1)then\n\tmale={{8050,8074,8098,8122,8146,},\n\t\t{8052,8076,8100,8124,8148,},\n\t\t{8054,8078,8102,8126,8150,},\n\t\t{8056,8080,8104,8128,8152,},\n\t\t{8058,8082,8106,8130,8154,},\n\t\t{8060,8084,8108,8132,8156,},\n\t\t{8062,8086,8110,8134,8158,},\n\t\t{8064,8088,8112,8136,8160,},\n\t\t{8066,8090,8114,8138,8162,},\n\t\t{8068,8092,8116,8140,8164,},\n\t\t{8070,8094,8118,8142,8166,},\n\t\t{8072,8096,8120,8144,8168,},}\n\t\ti=macro_Rand(5)+1\n\t\tiSx=macro_GetPlayerAttr(30)\n\t\tskillid=male[iSx][i]\n\telse\n\tfamale={{8051,8075,8099,8123,8147,},\n\t\t{8053,8077,8101,8125,8149,},\n\t\t{8055,8079,8103,8127,8151,},\n\t\t{8057,8081,8105,8129,8153,},\n\t\t{8059,8083,8107,8131,8155,},\n\t\t{8061,8085,8109,8133,8157,},\n\t\t{8063,8087,8111,8135,8159,},\n\t\t{8065,8089,8113,8137,8161,},\n\t\t{8067,8091,8115,8139,8163,},\n\t\t{8069,8093,8117,8141,8165,},\n\t\t{8071,8095,8119,8143,8167,},\n\t\t{8073,8097,8121,8145,8169,},}\n\t\ti=macro_Rand(5)+1\n\t\tiSx=macro_GetPlayerAttr(30)\n\t\tskillid=famale[iSx][i]"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3224,
          mapId = 112,
          count = 10,
          monsterId = 5187,
          description = "Kill 10 \"Venomous Spider\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3224,
          mapId = 112,
          count = 1,
          monsterId = 5339,
          description = "Locate \"Simois\" and borrow \"Rose Gold Flute\" .Then kill \"Carp Sprite\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3224,
          mapId = 112,
          count = 1,
          monsterId = 5340,
          description = "Kill \"Golden Beast\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 253,
      title = "The Eudemon",
      startNpcId = 3651,
      minLevel = 5,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1000,
        gold = 0,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 7003,
                quantity = 1,
                name = "Herald Hairpin"
              },
              {
                templateId = 7005,
                quantity = 1,
                name = "Herald Boots"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 7003,
              quantity = 1,
              name = "Herald Hairpin"
            },
            {
              templateId = 7005,
              quantity = 1,
              name = "Herald Boots"
            }
          },
          rawBody = "Sex=macro_GetSex()\nif(Sex==1)then\n\tmacro_AddItem(7003,1,0)\n\tmacro_AddItem(7005,1,0)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3651,
          mapId = 102,
          count = 2,
          monsterId = 5001,
          description = "Kill 2 \"Dragonfly\" and 5 \"Beetle\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 254,
      title = "The Omen",
      startNpcId = 3651,
      minLevel = 10,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 3000,
        gold = 1000,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 7009,
                quantity = 1,
                name = "Abject Boots"
              },
              {
                templateId = 7007,
                quantity = 1,
                name = "Abject Hood"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 7009,
              quantity = 1,
              name = "Abject Boots"
            },
            {
              templateId = 7007,
              quantity = 1,
              name = "Abject Hood"
            }
          },
          rawBody = "Sex=macro_GetSex()\nif(Sex==1)then\n\tmacro_AddItem(7009,1,0)\n\tmacro_AddItem(7007,1,0)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3651,
          mapId = 102,
          count = nil,
          monsterId = nil,
          description = "At your 16 level, go to \"Map 163\" to speak with \"Zodiac Eudemon\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3651,
          mapId = 163,
          count = 2,
          monsterId = 5015,
          description = "Kill 2 \"Lonely Soul\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 255,
      title = "Another Possibility",
      startNpcId = 3651,
      minLevel = 16,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 7011,
                quantity = 1,
                name = "Demon Crown"
              },
              {
                templateId = 7013,
                quantity = 1,
                name = "Demon Boots"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 7011,
              quantity = 1,
              name = "Demon Crown"
            },
            {
              templateId = 7013,
              quantity = 1,
              name = "Demon Boots"
            }
          },
          rawBody = "Sex=macro_GetSex()\nif(Sex==1)then\n\tmacro_AddItem(7011,1,0)\n\tmacro_AddItem(7013,1,0)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3651,
          mapId = 146,
          count = 10,
          monsterId = 5062,
          description = "Kill 10 \"Mushroom\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3651,
          mapId = 146,
          count = 2,
          monsterId = 5067,
          description = "Kill 2 \"Withered Beast\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3651,
          mapId = 163,
          count = nil,
          monsterId = nil,
          description = "At your 24 Level, go to speak with \"Map 146\" or \"Zodiac Eudemon\"",
          consumeItems = {},
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 256,
      title = "Force of Zodiac",
      startNpcId = 3651,
      minLevel = 24,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21314,
          quantity = 1,
          name = "Zodiac Eudemon's Memory"
        }
      },
      rewards = {
        experience = 5000,
        gold = 0,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 5118,
                quantity = 1,
                name = "Zodiac Rod"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 5118,
              quantity = 1,
              name = "Zodiac Rod"
            }
          },
          rawBody = "macro_AddItem(5118,1,0)\niTemp=28+macro_GetTaskLevelFromAll(256)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*5000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3651,
          mapId = 146,
          count = nil,
          monsterId = nil,
          description = "Take \"Zodiac Eudemon's Memory\" with you to find out \"Force of Zodiac\" and bring it to \"Zodiac Eudemon\"",
          consumeItems = {
            {
              templateId = 21314,
              quantity = 1,
              name = "Zodiac Eudemon's Memory"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3651,
          mapId = 146,
          count = nil,
          monsterId = nil,
          description = "Speak with Mike in Cloud City to get \"Wine of Mind\" and bring to \"Zodiac Eudemon\"",
          consumeItems = {
            {
              templateId = 21316,
              quantity = 1,
              name = "Wine of Mind"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3651,
          mapId = 146,
          count = 1,
          monsterId = 5044,
          description = "Take \"Flawed Zodiac Rod\" to kill \"Black Widow\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 257,
      title = "True Power",
      startNpcId = 3651,
      minLevel = 24,
      prerequisiteTaskId = 256,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 5118,
                quantity = 1,
                name = "Zodiac Rod"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 5118,
              quantity = 1,
              name = "Zodiac Rod"
            }
          },
          rawBody = "macro_AddItem(5118,1,0)\niTemp=28+macro_GetTaskLevelFromAll(257)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*18000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*18000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3651,
          mapId = 146,
          count = nil,
          monsterId = nil,
          description = "At your 30 level, bring \"Zodiac Rod\" to \"Zodiac Eudemon\" in \"Map 111\"",
          consumeItems = {
            {
              templateId = 5118,
              quantity = 1,
              name = "Zodiac Rod"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 260,
      title = "The Threat",
      startNpcId = 3651,
      minLevel = 14,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 2000,
        gold = 0,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3651,
          mapId = 127,
          count = 2,
          monsterId = 5026,
          description = "Kill 2 \"Bandit\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 261,
      title = "The Right Path",
      startNpcId = 3651,
      minLevel = 30,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 10000,
        gold = 0,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3651,
          mapId = 129,
          count = 2,
          monsterId = 5188,
          description = "Kill 2 \"Evil Mushroom\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 351,
      title = "Dragonfly Catching",
      startNpcId = 3156,
      minLevel = 7,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 800,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 800,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(800)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3156,
          mapId = 101,
          count = 1,
          monsterId = 5001,
          description = "Capture a \"Dragonfly\" to \"Naive Boy\"",
          consumeItems = {},
          rawFlowType = "capture",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 353,
      title = "Behind the Curtain",
      startNpcId = 3004,
      minLevel = 1,
      prerequisiteTaskId = 4,
      acceptGrantItems = {},
      rewards = {
        experience = 2000,
        gold = 0,
        coins = 600,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3004,
          mapId = 101,
          count = nil,
          monsterId = nil,
          description = "Speak with \"Scholar\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3007,
          mapId = 103,
          count = nil,
          monsterId = 5006,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3023,
          mapId = 101,
          count = nil,
          monsterId = nil,
          description = "Speak with \"Grandpa\"",
          consumeItems = {},
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "kill",
          npcId = 3023,
          mapId = 103,
          count = 1,
          monsterId = 5006,
          description = "Kill \"Piggy\"--Bling Alley(75.238)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 354,
      title = "Passing the Love",
      startNpcId = 3003,
      minLevel = 1,
      prerequisiteTaskId = 355,
      acceptGrantItems = {
        {
          templateId = 21002,
          quantity = 1,
          name = "Sachet"
        }
      },
      rewards = {
        experience = 1000,
        gold = 500,
        coins = 800,
        renown = 20,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 24051,
                quantity = 1,
                name = "Angelic Pouch (7 day)"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1000,
          gold = 500,
          coins = 800,
          renown = 20,
          petTemplateIds = {},
          items = {
            {
              templateId = 24051,
              quantity = 1,
              name = "Angelic Pouch (7 day)"
            }
          },
          rawBody = "macro_AddExp(1000)\nmacro_AddMoney(500)\nmacro_AddTongBan(800)\nmacro_AddRp(20)\nmacro_AddItemBangDing(24051,1,0)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3030,
          mapId = 103,
          count = nil,
          monsterId = nil,
          description = "Bring \"Sachet\" to \"Hubbert\"",
          consumeItems = {
            {
              templateId = 21002,
              quantity = 1,
              name = "Sachet"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3028,
          mapId = 102,
          count = nil,
          monsterId = nil,
          description = "Bring \"Fennel\" to \"Maria\"",
          consumeItems = {
            {
              templateId = 21051,
              quantity = 1,
              name = "Fennel"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3030,
          mapId = 103,
          count = nil,
          monsterId = nil,
          description = "Bring \"Sachet\" to \"Hubbert\"",
          consumeItems = {
            {
              templateId = 21002,
              quantity = 1,
              name = "Sachet"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "kill",
          npcId = 3030,
          mapId = 112,
          count = 1,
          monsterId = nil,
          description = "Speak to \"Hubbert\" to know more about Renown Quest reward: Experience: 1000 Gold: 500 Coin: 800 Renown: 20 Quest Description: In Cloud City,Hubbert enjoys great renown and you can refer to him for your renown question. Renown is closely related with your money and skill proficiency degree. ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <204000><0>Previous ¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡ <200001><0>Back",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 355,
      title = "Hungry Wolves",
      startNpcId = 3023,
      minLevel = 1,
      prerequisiteTaskId = 353,
      acceptGrantItems = {},
      rewards = {
        experience = 3000,
        gold = 0,
        coins = 700,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 5002,
                quantity = 1,
                name = "Petal Fan"
              }
            }
          },
          {
            awardId = 2,
            items = {
              {
                templateId = 5003,
                quantity = 1,
                name = "Glazed Flask"
              }
            }
          },
          {
            awardId = 3,
            items = {
              {
                templateId = 5004,
                quantity = 1,
                name = "Bronze Kettle"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 3000,
          gold = nil,
          coins = 700,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 5002,
              quantity = 1,
              name = "Petal Fan"
            }
          },
          rawBody = "macro_AddItem(5002,1,0)\nmacro_AddExp(3000)\nmacro_AddTongBan(700)"
        },
        {
          awardId = 2,
          experience = 3000,
          gold = nil,
          coins = 700,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 5003,
              quantity = 1,
              name = "Glazed Flask"
            }
          },
          rawBody = "macro_AddItem(5003,1,0)\nmacro_AddExp(3000)\nmacro_AddTongBan(700)"
        },
        {
          awardId = 3,
          experience = 3000,
          gold = nil,
          coins = 700,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 5004,
              quantity = 1,
              name = "Bronze Kettle"
            }
          },
          rawBody = "macro_AddItem(5004,1,0)\nmacro_AddExp(3000)\nmacro_AddTongBan(700)"
        }
      },
      steps = {
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3003,
          mapId = 103,
          count = nil,
          monsterId = nil,
          description = "Travel to \"Map 102\" to locate \"Farmer\"",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3003,
          mapId = 102,
          count = 1,
          monsterId = nil,
          description = "Kill Hungry Wolf---Bling Alley(116.97)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 356,
      title = "The Lost Child",
      startNpcId = 3055,
      minLevel = 9,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1000,
        gold = 200,
        coins = 300,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1000,
          gold = 200,
          coins = 300,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(1000)\nmacro_AddMoney(200)\nmacro_AddTongBan(300)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3070,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Take \"Eric\" home",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 357,
      title = "Pork Soup",
      startNpcId = 3191,
      minLevel = 20,
      prerequisiteTaskId = 391,
      acceptGrantItems = {
        {
          templateId = 21047,
          quantity = 1,
          name = "Piggy Circle"
        }
      },
      rewards = {
        experience = 600,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(358)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*600,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*600,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3183,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Piggy Circle\" to \"Jasmin\"",
          consumeItems = {
            {
              templateId = 21047,
              quantity = 1,
              name = "Piggy Circle"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 358,
      title = "Fake It to Make It",
      startNpcId = 3059,
      minLevel = 16,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 2400,
        gold = 800,
        coins = 800,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(358)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*2400,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*2400,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3059,
          mapId = 112,
          count = 1,
          monsterId = 5126,
          description = "Kill \"Zombie\"-Cloud City(89.369)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 359,
      title = "The Baby Wolf",
      startNpcId = 3174,
      minLevel = 9,
      prerequisiteTaskId = 355,
      acceptGrantItems = {
        {
          templateId = 21109,
          quantity = 1,
          name = "Boar Meat"
        }
      },
      rewards = {
        experience = 0,
        gold = 1550,
        coins = 1550,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = 1550,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddMoney(1550)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3174,
          mapId = 102,
          count = nil,
          monsterId = nil,
          description = "Gather some \"Boar Meat\" for the baby wolves.",
          consumeItems = {
            {
              templateId = 21109,
              quantity = 1,
              name = "Boar Meat"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3174,
          mapId = 102,
          count = nil,
          monsterId = nil,
          description = "Gather some \"Boar Meat\" to the wolf.",
          consumeItems = {
            {
              templateId = 21109,
              quantity = 1,
              name = "Boar Meat"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 361,
      title = "A Plague Errand",
      startNpcId = 3065,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21003,
          quantity = 1,
          name = "Famous Painting"
        }
      },
      rewards = {
        experience = 800,
        gold = 0,
        coins = 500,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 11004,
                quantity = 1,
                name = "Masterly Robe"
              }
            }
          },
          {
            awardId = 2,
            items = {
              {
                templateId = 16004,
                quantity = 1,
                name = "Plum Robe"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 800,
          gold = nil,
          coins = 500,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 11004,
              quantity = 1,
              name = "Masterly Robe"
            }
          },
          rawBody = "macro_AddItem(11004,1,0)\nmacro_AddExp(800)\nmacro_AddTongBan(500)"
        },
        {
          awardId = 2,
          experience = 800,
          gold = nil,
          coins = 500,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 16004,
              quantity = 1,
              name = "Plum Robe"
            }
          },
          rawBody = "macro_AddItem(16004,1,0)\nmacro_AddExp(800)\nmacro_AddTongBan(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3010,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Famous Painting\" back to \"Pub Owner\"",
          consumeItems = {
            {
              templateId = 21003,
              quantity = 1,
              name = "Famous Painting"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3009,
          mapId = 226,
          count = nil,
          monsterId = nil,
          description = "Bring \"Dish\" reserved by \"Diana\" to him",
          consumeItems = {
            {
              templateId = 21004,
              quantity = 1,
              name = "Dish"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3015,
          mapId = 223,
          count = nil,
          monsterId = nil,
          description = "Bring \"Chic Apparel\" to Warehouseman- \"Chelyn\"",
          consumeItems = {
            {
              templateId = 21005,
              quantity = 1,
              name = "Chic Apparel"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 4,
          type = "talk",
          npcId = 3022,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Chelyn's Invitation\" to \"Commander\"",
          consumeItems = {
            {
              templateId = 21181,
              quantity = 1,
              name = "Chelyn's Invitation"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 362,
      title = "Declaring war against Caterans",
      startNpcId = 3022,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1000,
        gold = 500,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1000,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(1000)\nmacro_AddMoney(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3022,
          mapId = 112,
          count = 1,
          monsterId = 5017,
          description = "Kill \"Cateran\"¡Á20",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 363,
      title = "Fighting against Bandits",
      startNpcId = 3022,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1000,
        gold = 500,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1000,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(1000)\nmacro_AddMoney(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3022,
          mapId = 112,
          count = 1,
          monsterId = 5026,
          description = "Kill \"Bandit\"¡Á20",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 365,
      title = "Ringleader of Cateran",
      startNpcId = 3022,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1500,
        gold = 500,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1500,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(1500)\nmacro_AddMoney(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3022,
          mapId = 112,
          count = 2,
          monsterId = 5181,
          description = "Kill 2 \"Ringleader of Cateran\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 366,
      title = "Ringleader of Bandit",
      startNpcId = 3022,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1500,
        gold = 500,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1500,
          gold = 500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(1500)\nmacro_AddMoney(500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3022,
          mapId = 112,
          count = nil,
          monsterId = 5028,
          description = "ÏûÃð ¶þ¸ö\"Ringleader of Bandit\"",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 367,
      title = "Evil Giant Bear",
      startNpcId = 3022,
      minLevel = 22,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1000,
        gold = 3200,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(367)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*10000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*10000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3022,
          mapId = 112,
          count = 10,
          monsterId = 5063,
          description = "Kill 10 noisy \"Giant Bear\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 369,
      title = "Battle between Beetles",
      startNpcId = 3181,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 300,
        gold = 300,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 300,
          gold = 300,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(300)\nmacro_AddMoney(300)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3181,
          mapId = 112,
          count = 1,
          monsterId = 5002,
          description = "Capture a \"Beetle\" to \"Ryan\"",
          consumeItems = {},
          rawFlowType = "capture",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 370,
      title = "Rare Material",
      startNpcId = 3009,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21110,
          quantity = 1,
          name = "Lizard Skin"
        }
      },
      rewards = {
        experience = 0,
        gold = 600,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = 600,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddMoney(600)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3009,
          mapId = 223,
          count = nil,
          monsterId = nil,
          description = "Collect 5 \"Lizard Skin\"",
          consumeItems = {
            {
              templateId = 21110,
              quantity = 1,
              name = "Lizard Skin"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 371,
      title = "Blacksmith's Food",
      startNpcId = 3182,
      minLevel = 22,
      prerequisiteTaskId = 379,
      acceptGrantItems = {
        {
          templateId = 21020,
          quantity = 1,
          name = "Blacksmith's Dish"
        }
      },
      rewards = {
        experience = 2000,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 2000,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddTouXianNum(117)\nmacro_AddExp(2000)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3008,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "By the way, bring \"Blacksmith's Dish\" to \"Blacksmith\"",
          consumeItems = {
            {
              templateId = 21020,
              quantity = 1,
              name = "Blacksmith's Dish"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 373,
      title = "Separation",
      startNpcId = 3070,
      minLevel = 12,
      prerequisiteTaskId = 385,
      acceptGrantItems = {
        {
          templateId = 21059,
          quantity = 1,
          name = "Wine Gourd"
        }
      },
      rewards = {
        experience = 1600,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(373)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*1600,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*1600,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3070,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Wine Gourd\" to \"Gladys\"",
          consumeItems = {
            {
              templateId = 21059,
              quantity = 1,
              name = "Wine Gourd"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3073,
          mapId = 112,
          count = nil,
          monsterId = 5027,
          description = "Bring \"Gladys's Ring\" to \"Outcast\"",
          consumeItems = {
            {
              templateId = 21023,
              quantity = 1,
              name = "Gladys's Ring"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 375,
      title = "Catcher White Azrael",
      startNpcId = 3079,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1240,
        gold = 2546,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1240,
          gold = 2546,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(1240)\nmacro_AddMoney(2546)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3079,
          mapId = 160,
          count = 1,
          monsterId = 5015,
          description = "Capture 2 \"Lonely Soul\" to \"White Azrael\"",
          consumeItems = {},
          rawFlowType = "capture",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 376,
      title = "Green Worm",
      startNpcId = 3183,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1000,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1000,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddTouXianNum(115)\nmacro_AddExp(1000)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3183,
          mapId = 112,
          count = 20,
          monsterId = nil,
          description = "Kill 20 amorous Green Worms",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 377,
      title = "Beggar's Secret",
      startNpcId = 3183,
      minLevel = 20,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21186,
          quantity = 1,
          name = "Silk Clothes"
        }
      },
      rewards = {
        experience = 2000,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(377)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*2000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*2000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3058,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Silk Clothes\" to \"Beggar\"",
          consumeItems = {
            {
              templateId = 21186,
              quantity = 1,
              name = "Silk Clothes"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3058,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Carbonado\" and \"Heaven Wine\" to \"Beggar\"",
          consumeItems = {
            {
              templateId = 20009,
              quantity = 1,
              name = "Carbonado"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 378,
      title = "Fairy's First Thing",
      startNpcId = 3183,
      minLevel = 20,
      prerequisiteTaskId = 377,
      acceptGrantItems = {
        {
          templateId = 21047,
          quantity = 1,
          name = "Piggy Circle"
        }
      },
      rewards = {
        experience = 500,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(378)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*500,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*500,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3191,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring the enchanted \"Piggy Circle\" to \"Samuel\"",
          consumeItems = {
            {
              templateId = 21047,
              quantity = 1,
              name = "Piggy Circle"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 379,
      title = "Fairy's 2nd Thing",
      startNpcId = 3183,
      minLevel = 20,
      prerequisiteTaskId = 378,
      acceptGrantItems = {},
      rewards = {
        experience = 5000,
        gold = 1000,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 21119,
                quantity = 1,
                name = "Fairy's Note"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 21119,
              quantity = 1,
              name = "Fairy's Note"
            }
          },
          rawBody = "macro_AddItem(21119,1,0)\niTemp=28+macro_GetTaskLevelFromAll(379)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*5000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3183,
          mapId = 112,
          count = 1,
          monsterId = 5127,
          description = "Kill monster who disguised as \"Detective Lee\"-Cloud City(134.111)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 385,
      title = "Prison Breaker",
      startNpcId = 3188,
      minLevel = 12,
      prerequisiteTaskId = 384,
      acceptGrantItems = {},
      rewards = {
        experience = 8000,
        gold = 1000,
        coins = 1200,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 21059,
                quantity = 1,
                name = "Wine Gourd"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 21059,
              quantity = 1,
              name = "Wine Gourd"
            }
          },
          rawBody = "macro_AddItem(21059,1,0)\niTemp=28+macro_GetTaskLevelFromAll(385)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*5000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3188,
          mapId = 112,
          count = nil,
          monsterId = 5133,
          description = "Arrest \"Prison Breaker\"-Cloud City(142.83)",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 387,
      title = "Leverage",
      startNpcId = 3077,
      minLevel = 12,
      prerequisiteTaskId = 386,
      acceptGrantItems = {},
      rewards = {
        experience = 8000,
        gold = 2000,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddTouXianNum(118)\niTemp=28+macro_GetTaskLevelFromAll(387)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*8000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*8000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3022,
          mapId = 127,
          count = nil,
          monsterId = 5029,
          description = "Escort \"Heather\" to \"Map 112\" take him to \"Commander\"",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3022,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "In \"Commander\" 's name, go to arrest ¡°Dollary¡±",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 388,
      title = "The Conspiracy",
      startNpcId = 3073,
      minLevel = 18,
      prerequisiteTaskId = 386,
      acceptGrantItems = {},
      rewards = {
        experience = 7570,
        gold = 3257,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 7570,
          gold = 3257,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(7570)\nmacro_AddMoney(3257)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3073,
          mapId = 128,
          count = nil,
          monsterId = 5128,
          description = "´ò°Ü \"Ninja\"",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3073,
          mapId = 145,
          count = 1,
          monsterId = 5128,
          description = "Kill \"Ninja\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 389,
      title = "Gourd with Blood",
      startNpcId = 3073,
      minLevel = 18,
      prerequisiteTaskId = 388,
      acceptGrantItems = {
        {
          templateId = 21053,
          quantity = 1,
          name = "Bloody Gourd"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 9011,
                quantity = 1,
                name = "Cardinal Gourd"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 9011,
              quantity = 1,
              name = "Cardinal Gourd"
            }
          },
          rawBody = "macro_AddTouXianNum(118)\nmacro_AddItem(9011,1,0)\niTemp=28+macro_GetTaskLevelFromAll(389)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*8000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*8000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3022,
          mapId = 145,
          count = nil,
          monsterId = nil,
          description = "Bring \"Bloody Gourd\" to \"Commander\"",
          consumeItems = {
            {
              templateId = 21053,
              quantity = 1,
              name = "Bloody Gourd"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 391,
      title = "Mother's Illness",
      startNpcId = 3191,
      minLevel = 20,
      prerequisiteTaskId = 378,
      acceptGrantItems = {
        {
          templateId = 21182,
          quantity = 1,
          name = "Heart Powder"
        }
      },
      rewards = {
        experience = 2500,
        gold = 800,
        coins = 1500,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(391)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*2500,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*2500,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3191,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Help \"Samuel\" to gather 10 \"Heart Powder\"",
          consumeItems = {
            {
              templateId = 21182,
              quantity = 1,
              name = "Heart Powder"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 392,
      title = "Blessing Purse",
      startNpcId = 3193,
      minLevel = 20,
      prerequisiteTaskId = 357,
      acceptGrantItems = {},
      rewards = {
        experience = 50000,
        gold = 0,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddTouXianNum(111)\niTemp=28+macro_GetTaskLevelFromAll(392)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*5000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3193,
          mapId = 112,
          count = 1,
          monsterId = 5132,
          description = "Kill \"Ghost Pig\"-Fall Alley(97.59)",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3193,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring 10 \"Memorial Fragment\" to \"Soul of Heaven\"",
          consumeItems = {
            {
              templateId = 23029,
              quantity = 1,
              name = "Memorial Fragment"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3193,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Fine Silk\" to \"Soul of Heaven\"",
          consumeItems = {
            {
              templateId = 21026,
              quantity = 1,
              name = "Fine Silk"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 4,
          type = "talk",
          npcId = 3191,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Blessed Sachet\" to \"Samuel\"",
          consumeItems = {
            {
              templateId = 21027,
              quantity = 1,
              name = "Blessed Sachet"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 393,
      title = "Recovery",
      startNpcId = 3191,
      minLevel = 20,
      prerequisiteTaskId = 391,
      acceptGrantItems = {
        {
          templateId = 21049,
          quantity = 1,
          name = "Info On Sow"
        }
      },
      rewards = {
        experience = 1000,
        gold = 2000,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 1000,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddTouXianNum(112)\nmacro_AddExp(1000)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3013,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Bring \"Info On Sow\" to \"Pet Curer\"",
          consumeItems = {
            {
              templateId = 21049,
              quantity = 1,
              name = "Info On Sow"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3013,
          mapId = 228,
          count = nil,
          monsterId = nil,
          description = "Help to gather 5 \"Worm Spine\" and 5 \"Memorial Fragment\"",
          consumeItems = {
            {
              templateId = 23004,
              quantity = 1,
              name = "Worm Spine"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3191,
          mapId = 228,
          count = nil,
          monsterId = nil,
          description = "Bring \"Recovered Sow\" back to \"Samuel\"",
          consumeItems = {
            {
              templateId = 21028,
              quantity = 1,
              name = "Recovered Sow"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 398,
      title = "Unexpected Help",
      startNpcId = 3083,
      minLevel = 27,
      prerequisiteTaskId = 399,
      acceptGrantItems = {},
      rewards = {
        experience = 12000,
        gold = 0,
        coins = 1500,
        renown = 0,
        pets = {
          "pet"
        },
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {
            "pet"
          },
          items = {},
          rawBody = "i=macro_Rand(3)\npet=2501+i\nmacro_AddPet(pet)\niTemp=28+macro_GetTaskLevelFromAll(398)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*12000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*12000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3083,
          mapId = 132,
          count = 1,
          monsterId = 5080,
          description = "Kill \"Revenant\"-Butterfly Peak(93.107)",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 399,
      title = "Zodiac Order",
      startNpcId = 3084,
      minLevel = 27,
      prerequisiteTaskId = 395,
      acceptGrantItems = {},
      rewards = {
        experience = 10000,
        gold = 1500,
        coins = 1500,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(399)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*10000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*10000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3084,
          mapId = 132,
          count = 1,
          monsterId = 5217,
          description = "Kill \"Specter\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 2,
          type = "kill_collect",
          npcId = 3084,
          mapId = 132,
          count = nil,
          monsterId = 5216,
          description = "Kill \"Apparition\" and obtain \"Zodiac Brand\"",
          consumeItems = {
            {
              templateId = 21055,
              quantity = 1,
              name = "Zodiac Brand"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 404,
      title = "Cobweb",
      startNpcId = 3199,
      minLevel = 25,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21183,
          quantity = 1,
          name = "Fine Spider Silk"
        }
      },
      rewards = {
        experience = 8000,
        gold = 1000,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 9017,
                quantity = 1,
                name = "Spider Web"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 9017,
              quantity = 1,
              name = "Spider Web"
            }
          },
          rawBody = "macro_AddItem(26045,1,0)\nmacro_AddItem(26045,1,1)\nmacro_AddItem(26045,1,2)\niTemp=28+macro_GetTaskLevelFromAll(404)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*8000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*8000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3199,
          mapId = 131,
          count = nil,
          monsterId = nil,
          description = "Collect 10 \"Fine Spider Silk\"",
          consumeItems = {
            {
              templateId = 21183,
              quantity = 1,
              name = "Fine Spider Silk"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 406,
      title = "Fierce Tortoise",
      startNpcId = 3204,
      minLevel = 30,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 12000,
        gold = 2400,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(406)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*12000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*12000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3204,
          mapId = 111,
          count = 20,
          monsterId = 5092,
          description = "Kill 20 \"Thorny Tortoise\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 407,
      title = "Good Luck",
      startNpcId = 3060,
      minLevel = 12,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 1000,
        gold = 1000,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = 1000,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddMoney(1000)\niTemp=28+macro_GetTaskLevelFromAll(407)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*1000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*1000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3018,
          mapId = 112,
          count = nil,
          monsterId = nil,
          description = "Take Fortune Rune with you and speak to Ralph.",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 408,
      title = "Achelous's Tortoise",
      startNpcId = 3093,
      minLevel = 32,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21065,
          quantity = 1,
          name = "Info on Tortoise"
        }
      },
      rewards = {
        experience = 40000,
        gold = 2000,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 9018,
                quantity = 1,
                name = "Rare Turtle Shell"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 9018,
              quantity = 1,
              name = "Rare Turtle Shell"
            }
          },
          rawBody = "macro_AddItem(26047,1,0)\nmacro_AddItem(26047,1,2)\niTemp=28+macro_GetTaskLevelFromAll(408)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*40000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*40000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3093,
          mapId = 111,
          count = nil,
          monsterId = 5086,
          description = "Kill \"Hill Patroller\" to obtain \"Info on Tortoise\"",
          consumeItems = {
            {
              templateId = 21065,
              quantity = 1,
              name = "Info on Tortoise"
            }
          },
          rawFlowType = "kill_collect"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3019,
          mapId = 111,
          count = nil,
          monsterId = 5328,
          description = "Take \"Info on Miser\" to locate \"Miser\"",
          consumeItems = {
            {
              templateId = 21066,
              quantity = 1,
              name = "Info on Miser"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3093,
          mapId = 108,
          count = nil,
          monsterId = 5110,
          description = "Bring \"Gold Tortoise\" back to \"Achelous\"",
          consumeItems = {
            {
              templateId = 21035,
              quantity = 1,
              name = "Gold Tortoise"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 413,
      title = "Weird Medicine",
      startNpcId = 3100,
      minLevel = 31,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 6000,
        gold = 2400,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 6000,
          gold = 2400,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(6000)\nmacro_AddMoney(2400)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3100,
          mapId = 135,
          count = 10,
          monsterId = 5090,
          description = "Kill 10 \"Rock Goblin\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 415,
      title = "Training",
      startNpcId = 3098,
      minLevel = 33,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 8000,
        gold = 2400,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 8000,
          gold = 2400,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(8000)\nmacro_AddMoney(2400)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3098,
          mapId = 164,
          count = nil,
          monsterId = 5086,
          description = "´ò°Ü 10¸ö\"Hill Patroller\"¡¢10¸ö\"Hill Roamer\"",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 416,
      title = "Trumpet Shell",
      startNpcId = 3125,
      minLevel = 30,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21184,
          quantity = 1,
          name = "Exquisite Trumpet Shell"
        }
      },
      rewards = {
        experience = 26000,
        gold = 2400,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 8013,
                quantity = 1,
                name = "Whelk Necklace"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 8013,
              quantity = 1,
              name = "Whelk Necklace"
            }
          },
          rawBody = "macro_AddItem(8013,1,0)\niTemp=28+macro_GetTaskLevelFromAll(416)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*26000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*26000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3125,
          mapId = 229,
          count = nil,
          monsterId = nil,
          description = "Collect 10 \"Exquisite Trumpet Shell\"",
          consumeItems = {
            {
              templateId = 21184,
              quantity = 1,
              name = "Exquisite Trumpet Shell"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 417,
      title = "Carp King's Sin",
      startNpcId = 3052,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 8000,
        gold = 2400,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 8000,
          gold = 2400,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(8000)\nmacro_AddMoney(2400)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3052,
          mapId = 214,
          count = 20,
          monsterId = 5096,
          description = "Kill 20 \"Carp King\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 418,
      title = "Copper",
      startNpcId = 3050,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21071,
          quantity = 1,
          name = "Nowt's Letter"
        }
      },
      rewards = {
        experience = 2500,
        gold = 800,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 2500,
          gold = 800,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(2500)\nmacro_AddMoney(800)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3256,
          mapId = 155,
          count = nil,
          monsterId = nil,
          description = "Bring \"Nowt's Letter\" to \"Copper\"",
          consumeItems = {
            {
              templateId = 21071,
              quantity = 1,
              name = "Nowt's Letter"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3256,
          mapId = 155,
          count = nil,
          monsterId = 5050,
          description = "Help Copper to arrest \"Greedy Ghost\"",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 419,
      title = "Past Sins",
      startNpcId = 3257,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 20013,
          quantity = 1,
          name = "Hot Crayfish"
        }
      },
      rewards = {
        experience = 2500,
        gold = 1200,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 2500,
          gold = 1200,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(2500)\nmacro_AddMoney(1200)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3261,
          mapId = 156,
          count = nil,
          monsterId = 5051,
          description = "Bring \"Hot Crayfish\" to \"Sufferer\"",
          consumeItems = {
            {
              templateId = 20013,
              quantity = 1,
              name = "Hot Crayfish"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3031,
          mapId = 155,
          count = nil,
          monsterId = nil,
          description = "Bring \"Will of Greedy Ghost\" to his grandson",
          consumeItems = {
            {
              templateId = 21134,
              quantity = 1,
              name = "Will of Greedy Ghost"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 426,
      title = "Rebel in Hell",
      startNpcId = 3262,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 28000,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 28000,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(28000)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3262,
          mapId = 158,
          count = 10,
          monsterId = 5165,
          description = "Kill 10¸ö\"Evil Rogue\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3263,
          mapId = 158,
          count = nil,
          monsterId = nil,
          description = "Bring \"Order Letter\" to \"Green Hoe\"",
          consumeItems = {
            {
              templateId = 21076,
              quantity = 1,
              name = "Order Letter"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3124,
          mapId = 158,
          count = nil,
          monsterId = nil,
          description = "Bring \"Info on Blue Hoe\" to \"Soul Judge\"",
          consumeItems = {
            {
              templateId = 21074,
              quantity = 1,
              name = "Info on Blue Hoe"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 428,
      title = "Builup of Evil Troop",
      startNpcId = 3263,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 32000,
        gold = 2400,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 32000,
          gold = 2400,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(32000)\nmacro_AddMoney(2400)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3263,
          mapId = 158,
          count = 1,
          monsterId = 5188,
          description = "Capture 5\"Evil Mushroom\"",
          consumeItems = {},
          rawFlowType = "capture"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3263,
          mapId = 158,
          count = nil,
          monsterId = 5218,
          description = "Take \"Tiercel\" back",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 431,
      title = "Piggy's Comeback",
      startNpcId = 3265,
      minLevel = 12,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 4000,
        gold = 0,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 26004,
                quantity = 3,
                name = "Treasure Map (S)"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 26004,
              quantity = 3,
              name = "Treasure Map (S)"
            }
          },
          rawBody = "macro_AddItem(26004,3,0)\niTemp=28+macro_GetTaskLevelFromAll(431)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3265,
          mapId = 112,
          count = 3,
          monsterId = 5170,
          description = "Kill 3 \"Little Piggy\"\\",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 432,
      title = "Piggy Leader",
      startNpcId = 3265,
      minLevel = 1,
      prerequisiteTaskId = 431,
      acceptGrantItems = {},
      rewards = {
        experience = 6000,
        gold = 1000,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 26015,
                quantity = 3,
                name = "Equipment Treasure Map (Primary"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 6000,
          gold = 1000,
          coins = 1000,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 26015,
              quantity = 3,
              name = "Equipment Treasure Map (Primary"
            }
          },
          rawBody = "macro_AddItem(26015,3,0)\nmacro_AddExp(6000)\nmacro_AddMoney(1000)\nmacro_AddTongBan(1000)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3265,
          mapId = 112,
          count = 1,
          monsterId = 5171,
          description = "Kill one \"Piggy Leader\"\\",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 450,
      title = "The Rumor",
      startNpcId = 3353,
      minLevel = 50,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21229,
          quantity = 1,
          name = "Bamboo Tube"
        }
      },
      rewards = {
        experience = 100000,
        gold = 0,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(450)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*100000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*100000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3353,
          mapId = 109,
          count = 1,
          monsterId = 5237,
          description = "Kill \"Little Leopard\" and bring \"Bamboo Tube\" to \"Laura\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 2,
          type = "kill_collect",
          npcId = 3353,
          mapId = 109,
          count = nil,
          monsterId = nil,
          description = "According to information of \"Bamboo Tube\" , locate and kill Firewood Beast to get \"Complete Bamboo Tube\"",
          consumeItems = {
            {
              templateId = 21229,
              quantity = 1,
              name = "Bamboo Tube"
            },
            {
              templateId = 21230,
              quantity = 1,
              name = "Complete Bamboo Tube"
            }
          },
          rawFlowType = "kill_collect"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3343,
          mapId = 109,
          count = nil,
          monsterId = nil,
          description = "Escort \"Laura\" back to \"Map 169\" \"Grandma Keyla\"",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 451,
      title = "The Giant Petal",
      startNpcId = 3278,
      minLevel = 50,
      prerequisiteTaskId = 450,
      acceptGrantItems = {
        {
          templateId = 23075,
          quantity = 1,
          name = "Large Petal"
        }
      },
      rewards = {
        experience = 60000,
        gold = 2000,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(451)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*60000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*60000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3278,
          mapId = 169,
          count = nil,
          monsterId = 5232,
          description = "Kill \"Maneating Flower\" and get \"Large Petal\"¡Á10",
          consumeItems = {
            {
              templateId = 23075,
              quantity = 1,
              name = "Large Petal"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 452,
      title = "The Difficulty",
      startNpcId = 3343,
      minLevel = 50,
      prerequisiteTaskId = 451,
      acceptGrantItems = {
        {
          templateId = 21231,
          quantity = 1,
          name = "Rice Porridge"
        }
      },
      rewards = {
        experience = 100000,
        gold = 0,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(452)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*100000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*100000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3353,
          mapId = 169,
          count = nil,
          monsterId = nil,
          description = "Bring \"Rice Porridge\" to \"Laura\"",
          consumeItems = {
            {
              templateId = 21231,
              quantity = 1,
              name = "Rice Porridge"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "kill_collect",
          npcId = 3278,
          mapId = 169,
          count = nil,
          monsterId = 5198,
          description = "Kill \"Armored Tortoise\" to obtain \"Turtle Shell Powder\"¡Á10",
          consumeItems = {
            {
              templateId = 21232,
              quantity = 1,
              name = "Turtle Shell Powder"
            }
          },
          rawFlowType = "kill_collect"
        },
        {
          stepIndex = 3,
          type = "kill_collect",
          npcId = 3278,
          mapId = 169,
          count = nil,
          monsterId = 5240,
          description = "Kill \"Locust\" to obtain \"Rare Insect\"¡Á10",
          consumeItems = {
            {
              templateId = 21233,
              quantity = 1,
              name = "Rare Insect"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 453,
      title = "The Suffering",
      startNpcId = 3278,
      minLevel = 50,
      prerequisiteTaskId = 452,
      acceptGrantItems = {
        {
          templateId = 21234,
          quantity = 1,
          name = "Purple Block"
        }
      },
      rewards = {
        experience = 80000,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(453)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*80000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*80000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3353,
          mapId = 169,
          count = nil,
          monsterId = 5281,
          description = "Kill \"Tree Spirit\" to obtain \"Purple Block\"",
          consumeItems = {
            {
              templateId = 21234,
              quantity = 1,
              name = "Purple Block"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 454,
      title = "Plague of Locusts",
      startNpcId = 3344,
      minLevel = 52,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 100000,
        gold = 3000,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(454)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*100000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*100000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3344,
          mapId = 169,
          count = 1,
          monsterId = 5240,
          description = "Kill \"Locust\"¡Á20 and report to \"Guardian\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 455,
      title = "Evil Dragon",
      startNpcId = 3347,
      minLevel = 52,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 200000,
        gold = 2000,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(455)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*200000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*200000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3347,
          mapId = 240,
          count = 1,
          monsterId = 5280,
          description = "Kill \"Clan Guard\" , you will see \"Old Shaikh\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3355,
          mapId = 113,
          count = nil,
          monsterId = 5335,
          description = "Bring \"Swaddle\" to \"Elizabeth\"",
          consumeItems = {
            {
              templateId = 21235,
              quantity = 1,
              name = "Swaddle"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 456,
      title = "The Dragon's Growth",
      startNpcId = 3355,
      minLevel = 52,
      prerequisiteTaskId = 455,
      acceptGrantItems = {
        {
          templateId = 21236,
          quantity = 1,
          name = "Lotus Petal"
        }
      },
      rewards = {
        experience = 80000,
        gold = 1000,
        coins = 1000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(456)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*80000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*80000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3347,
          mapId = 114,
          count = nil,
          monsterId = nil,
          description = "Bring \"Lotus Petal\" to \"Vannessa\"",
          consumeItems = {
            {
              templateId = 21236,
              quantity = 1,
              name = "Lotus Petal"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3347,
          mapId = 114,
          count = nil,
          monsterId = 5278,
          description = "Bring \"Parcel\" to \"White Dragon\"",
          consumeItems = {
            {
              templateId = 21237,
              quantity = 1,
              name = "Parcel"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "kill",
          npcId = 3356,
          mapId = 114,
          count = 1,
          monsterId = 5236,
          description = "Kill \"Fat Pig\" to collect 10 \"Fresh Pork\" to \"White Dragon\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 457,
      title = "Lonely Heart",
      startNpcId = 3356,
      minLevel = 52,
      prerequisiteTaskId = 456,
      acceptGrantItems = {},
      rewards = {
        experience = 30000,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {
              {
                templateId = 21238,
                quantity = 1,
                name = "Dragon Scale"
              }
            }
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {
            {
              templateId = 21238,
              quantity = 1,
              name = "Dragon Scale"
            }
          },
          rawBody = "--macro_AddItem(21238,1,0)\n\niTemp=28+macro_GetTaskLevelFromAll(457)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*30000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*30000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3356,
          mapId = 114,
          count = 1,
          monsterId = 5199,
          description = "Capture a \"Iron Crab\" for \"White Dragon\"",
          consumeItems = {},
          rawFlowType = "capture",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 458,
      title = "Blood Is Thicker",
      startNpcId = 3347,
      minLevel = 52,
      prerequisiteTaskId = 457,
      acceptGrantItems = {
        {
          templateId = 21239,
          quantity = 1,
          name = "Fragile Wings"
        }
      },
      rewards = {
        experience = 300000,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(458)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*300000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*300000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3356,
          mapId = 240,
          count = nil,
          monsterId = 5234,
          description = "´ò°Ü \"Beatle Soldier\" Bring 15 \"Fragile Wings\" to \"White Dragon\"",
          consumeItems = {
            {
              templateId = 21239,
              quantity = 1,
              name = "Fragile Wings"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3361,
          mapId = 114,
          count = nil,
          monsterId = 5279,
          description = "Defeat \"Old Shaikh\" and see see how he will react",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 459,
      title = "Cruel Choice",
      startNpcId = 3361,
      minLevel = 52,
      prerequisiteTaskId = 457,
      acceptGrantItems = {
        {
          templateId = 21241,
          quantity = 1,
          name = "Dragon Bone"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(459)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*300000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*300000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3361,
          mapId = 113,
          count = nil,
          monsterId = 5278,
          description = "Kill \"White Dragon\" to obtain \"Dragon Bone\" and submit it to \"Old Shaikh\"",
          consumeItems = {
            {
              templateId = 21241,
              quantity = 1,
              name = "Dragon Bone"
            }
          },
          rawFlowType = "kill_collect"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3361,
          mapId = 236,
          count = nil,
          monsterId = 5278,
          description = "Defeat \"White Dragon\" and take \"Dragon Bone\" to \"Old Shaikh\"",
          consumeItems = {
            {
              templateId = 21241,
              quantity = 1,
              name = "Dragon Bone"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 460,
      title = "Sudden Attack",
      startNpcId = 3342,
      minLevel = 55,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21240,
          quantity = 1,
          name = "Letter of Perplexity"
        }
      },
      rewards = {
        experience = 80000,
        gold = 2500,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 80000,
          gold = 2500,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(80000)\nmacro_AddMoney(2500)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3345,
          mapId = 169,
          count = nil,
          monsterId = nil,
          description = "Bring \"Pet Feeder\"'s \"Letter of Perplexity\" to \"Captor Leo\"",
          consumeItems = {
            {
              templateId = 21240,
              quantity = 1,
              name = "Letter of Perplexity"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3345,
          mapId = 169,
          count = 15,
          monsterId = 5241,
          description = "Kill 15 \"Heart Demon\" and speak with\"Captor Leo\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 461,
      title = "Stubbornness",
      startNpcId = 3364,
      minLevel = 55,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 23077,
          quantity = 1,
          name = "Beetle Horn"
        }
      },
      rewards = {
        experience = 100000,
        gold = 2500,
        coins = 2000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(461)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*100000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*100000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3364,
          mapId = 239,
          count = 10,
          monsterId = 5234,
          description = "Kill \"Beatle Soldier\" to get 10 \"Beetle Horn\" . Then submit it to \"Joseph\"",
          consumeItems = {
            {
              templateId = 23077,
              quantity = 10,
              name = "Beetle Horn"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 462,
      title = "Frustration",
      startNpcId = 3365,
      minLevel = 56,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 180000,
        gold = 3500,
        coins = 3500,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(462)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*180000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*180000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3365,
          mapId = 238,
          count = 15,
          monsterId = 5241,
          description = "Kill 15 \"Heart Demon\" to find truth out and then go to check \"Palm\"",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3365,
          mapId = 238,
          count = 1,
          monsterId = 5241,
          description = "Kill \"Heart Demon\" to collect 10 \"Cracked Mirror\" for \"Palm\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 463,
      title = "Flying Little Mouse",
      startNpcId = 3366,
      minLevel = 57,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 100000,
        gold = 3000,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(463)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*100000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*100000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3366,
          mapId = 238,
          count = 1,
          monsterId = 5235,
          description = "Capture one \"Little Bat\" for \"Alexander\"",
          consumeItems = {},
          rawFlowType = "capture",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 464,
      title = "Saving the Doll",
      startNpcId = 3363,
      minLevel = 63,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 220000,
        gold = 0,
        coins = 3000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(464)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*220000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*220000,20))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3363,
          mapId = 240,
          count = 15,
          monsterId = 5243,
          description = "Kill 15 \"Child Corpse\" and then locate \"Old Witch Doctor\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 465,
      title = "Breaking His Words",
      startNpcId = 3379,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 23086,
          quantity = 1,
          name = "Yellow Clay"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3132,
          mapId = 166,
          count = 10,
          monsterId = 5246,
          description = "Kill \"One-eyed Beast\" to get 10 \"Yellow Clay\" and submit to \"Longicorn King\"",
          consumeItems = {
            {
              templateId = 23086,
              quantity = 10,
              name = "Yellow Clay"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 466,
      title = "Richard",
      startNpcId = 3380,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3380,
          mapId = 166,
          count = 10,
          monsterId = 5247,
          description = "Kill 10 \"Foliage Ghost\" and locate \"Richard\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 467,
      title = "Elfin",
      startNpcId = 3369,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21242,
          quantity = 1,
          name = "Indictment"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3381,
          mapId = 211,
          count = nil,
          monsterId = nil,
          description = "Bring \"Indictment\" to \"Elfin\" so as to expose his plot",
          consumeItems = {
            {
              templateId = 21242,
              quantity = 1,
              name = "Indictment"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3381,
          mapId = 166,
          count = 1,
          monsterId = 5282,
          description = "Kill \"Trick Sprite\" and give him a lesson",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 468,
      title = "Oil Story",
      startNpcId = 3370,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21382,
          quantity = 1,
          name = "Purchased Oil"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3370,
          mapId = 238,
          count = nil,
          monsterId = nil,
          description = "Locate \"Waiter\" to get Oil Bottle and bring it to \"Grocer Merchant\" . Then take \"Purchased Oil\" to \"Ryan\"",
          consumeItems = {
            {
              templateId = 21382,
              quantity = 1,
              name = "Purchased Oil"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 469,
      title = "Flaming Tree",
      startNpcId = 3371,
      minLevel = 64,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21247,
          quantity = 1,
          name = "Flaming Leaf"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3374,
          mapId = 211,
          count = nil,
          monsterId = nil,
          description = "Take \"Flaming Leaf\" to speak with \"Beauty\" for answer of Flaming tree's sickness",
          consumeItems = {
            {
              templateId = 21247,
              quantity = 1,
              name = "Flaming Leaf"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 470,
      title = "Drought",
      startNpcId = 3372,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21248,
          quantity = 1,
          name = "Tank"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3376,
          mapId = 211,
          count = nil,
          monsterId = nil,
          description = "Bring \"Tank\" to \"Nicholas\"",
          consumeItems = {
            {
              templateId = 21248,
              quantity = 1,
              name = "Tank"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3376,
          mapId = 182,
          count = 15,
          monsterId = 5248,
          description = "Kill 15 \"Jackal\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 471,
      title = "Sandworm",
      startNpcId = 3330,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3330,
          mapId = 211,
          count = 1,
          monsterId = 5251,
          description = "Capture one \"Sandworm\"",
          consumeItems = {},
          rawFlowType = "capture"
        },
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3330,
          mapId = 211,
          count = 1,
          monsterId = 5251,
          description = "Capture one \"Sandworm\"",
          consumeItems = {},
          rawFlowType = "capture",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 472,
      title = "The Rock",
      startNpcId = 3391,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3391,
          mapId = 170,
          count = 10,
          monsterId = 5257,
          description = "Kill 10 \"Gloom Grass\"and 10 \"Rock Flower\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 473,
      title = "Make A Fire",
      startNpcId = 3392,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 23092,
          quantity = 1,
          name = "Fire Stone"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3392,
          mapId = 170,
          count = 5,
          monsterId = 5252,
          description = "Kill \"Flame\" and get 5 \"Fire Stone\"",
          consumeItems = {
            {
              templateId = 23092,
              quantity = 5,
              name = "Fire Stone"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 474,
      title = "For Justice",
      startNpcId = 3393,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3393,
          mapId = 170,
          count = 10,
          monsterId = 5253,
          description = "Kill 10 \"Scorpion\" and tell \"Leif\" this good news",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 475,
      title = "Shared Tribute",
      startNpcId = 3377,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21249,
          quantity = 1,
          name = "Tribute"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3394,
          mapId = 182,
          count = nil,
          monsterId = nil,
          description = "Bring \"Tribute\" to \"Adrian\"",
          consumeItems = {
            {
              templateId = 21249,
              quantity = 1,
              name = "Tribute"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3382,
          mapId = 170,
          count = nil,
          monsterId = 5283,
          description = "Bring \"Tribute\" to \"Gany\" in \"Map 245\"",
          consumeItems = {
            {
              templateId = 21249,
              quantity = 1,
              name = "Tribute"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 476,
      title = "Violator Gany",
      startNpcId = 3382,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3382,
          mapId = 245,
          count = 20,
          monsterId = 5255,
          description = "Kill 20 \"Acicula\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 478,
      title = "Fake Immortal",
      startNpcId = 3382,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21250,
          quantity = 1,
          name = "Empty Basket"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3394,
          mapId = 245,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21250,
              quantity = 1,
              name = "Empty Basket"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3394,
          mapId = 170,
          count = 1,
          monsterId = 5283,
          description = "Kill the fake \"Gany\" and speak with \"Adrian\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 479,
      title = "The Reason",
      startNpcId = 3382,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21251,
          quantity = 1,
          name = "Gany's Testimony"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3382,
          mapId = 245,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21251,
              quantity = 1,
              name = "Gany's Testimony"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 480,
      title = "Club Spirit",
      startNpcId = 3383,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 23095,
          quantity = 1,
          name = "Thorn Agglomerate"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3438,
          mapId = 245,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 23095,
              quantity = 1,
              name = "Thorn Agglomerate"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3383,
          mapId = 165,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21285,
              quantity = 1,
              name = "Nether Sword"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 481,
      title = "Vulture Fight",
      startNpcId = 3383,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21252,
          quantity = 1,
          name = "Necklace"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3439,
          mapId = 245,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21252,
              quantity = 1,
              name = "Necklace"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3439,
          mapId = 166,
          count = 1,
          monsterId = nil,
          description = "Kill \"Vulture\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 482,
      title = "Happy Family",
      startNpcId = 3438,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3383,
          mapId = 245,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3383,
          mapId = 245,
          count = nil,
          monsterId = 5254,
          description = "",
          consumeItems = {
            {
              templateId = 21254,
              quantity = 1,
              name = "Centipede Powder"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 483,
      title = "The Fence",
      startNpcId = 3395,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21255,
          quantity = 1,
          name = "Twig bamboo"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3395,
          mapId = 170,
          count = 20,
          monsterId = 5258,
          description = "Kill \"Rock Flower\" to obtain 20 \"Twig bamboo\"",
          consumeItems = {
            {
              templateId = 21255,
              quantity = 20,
              name = "Twig bamboo"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 484,
      title = "Sudden Impulse",
      startNpcId = 3395,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3395,
          mapId = 170,
          count = nil,
          monsterId = 5294,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3396,
          mapId = 170,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21256,
              quantity = 1,
              name = "Fishy"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 485,
      title = "The Beauty",
      startNpcId = 3397,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21257,
          quantity = 1,
          name = "Meal"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3395,
          mapId = 170,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21257,
              quantity = 1,
              name = "Meal"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3397,
          mapId = 170,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21258,
              quantity = 1,
              name = "Gift"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 486,
      title = "The Truth",
      startNpcId = 3397,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21258,
          quantity = 1,
          name = "Gift"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3379,
          mapId = 170,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21258,
              quantity = 1,
              name = "Gift"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3378,
          mapId = 182,
          count = 1,
          monsterId = nil,
          description = "According to Tyrant's \"Scruffy Bag\" , find him out and kill him",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 3,
          type = "talk",
          npcId = 3397,
          mapId = 182,
          count = nil,
          monsterId = nil,
          description = "Bring \"Letter from Ava\" to \"Rane\"",
          consumeItems = {
            {
              templateId = 21259,
              quantity = 1,
              name = "Letter from Ava"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 487,
      title = "Saffron And Julia",
      startNpcId = 3398,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21260,
          quantity = 1,
          name = "Soup of Decline"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3401,
          mapId = 181,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21260,
              quantity = 1,
              name = "Soup of Decline"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 488,
      title = "Peach wood Timber",
      startNpcId = 3401,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21261,
          quantity = 1,
          name = "Trick"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3398,
          mapId = 161,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21261,
              quantity = 1,
              name = "Trick"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3398,
          mapId = 181,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 489,
      title = "Going the Wrong Way",
      startNpcId = 3401,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21262,
          quantity = 1,
          name = "Wonder Fruit"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3400,
          mapId = 161,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21262,
              quantity = 1,
              name = "Wonder Fruit"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 490,
      title = "Mountain Spirit's Story",
      startNpcId = 3402,
      minLevel = 90,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(490)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*1000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*1000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*1000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3402,
          mapId = 119,
          count = 1,
          monsterId = 5260,
          description = "Capture one \"Claybeast\" to \"Mount Spirit\"",
          consumeItems = {},
          rawFlowType = "capture",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 491,
      title = "Elaine's Reading",
      startNpcId = 3403,
      minLevel = 91,
      prerequisiteTaskId = 490,
      acceptGrantItems = {
        {
          templateId = 21263,
          quantity = 1,
          name = "Tome on Mountain God 1"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(491)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*4000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3403,
          mapId = 119,
          count = nil,
          monsterId = nil,
          description = "Bring \"Tome on Mountain God 1\" to \"Elaine\"",
          consumeItems = {
            {
              templateId = 21263,
              quantity = 1,
              name = "Tome on Mountain God 1"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3404,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21264,
              quantity = 1,
              name = "Good News"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3404,
          mapId = 204,
          count = nil,
          monsterId = 5259,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3404,
          mapId = 119,
          count = nil,
          monsterId = nil,
          description = "Bring \"Good News\" to \"Bob\"",
          consumeItems = {
            {
              templateId = 21264,
              quantity = 1,
              name = "Good News"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 3,
          type = "kill",
          npcId = 3404,
          mapId = 119,
          count = 10,
          monsterId = 5259,
          description = "Kill 10 \"Skull Soldier\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 5,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 493,
      title = "Bob's Reading",
      startNpcId = 3404,
      minLevel = 91,
      prerequisiteTaskId = 490,
      acceptGrantItems = {
        {
          templateId = 21263,
          quantity = 1,
          name = "Tome on Mountain God 1"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(493)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*5000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*5000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3404,
          mapId = 119,
          count = nil,
          monsterId = nil,
          description = "Bring \"Tome on Mountain God 1\" to \"Bob\"",
          consumeItems = {
            {
              templateId = 21263,
              quantity = 1,
              name = "Tome on Mountain God 1"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "kill",
          npcId = 3404,
          mapId = 119,
          count = 1,
          monsterId = nil,
          description = "Kill \"Mount Spirit\" to gain \"Bob\"'s confidence",
          consumeItems = {},
          rawFlowType = "kill"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3404,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21388,
              quantity = 1,
              name = "Bob's Information"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3402,
          mapId = 204,
          count = nil,
          monsterId = 5596,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 4,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 494,
      title = "The Curse",
      startNpcId = 3402,
      minLevel = 91,
      prerequisiteTaskId = 493,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(494)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*5000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*5000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*5000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3404,
          mapId = 161,
          count = nil,
          monsterId = 5597,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3402,
          mapId = 161,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3404,
          mapId = 119,
          count = nil,
          monsterId = 5244,
          description = "Travel to \"..macro_GetMapName()..\" to collect 10 \"Ghost Fire\" 's \"Nectar\" and then bring them to \"Bob\" for healing his blindness",
          consumeItems = {
            {
              templateId = 21266,
              quantity = 1,
              name = "Nectar"
            }
          },
          rawFlowType = "talk",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 495,
      title = "Soul Flower",
      startNpcId = 3405,
      minLevel = 93,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(495)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*1000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*1000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*1000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "capture",
          npcId = 3405,
          mapId = 186,
          count = 1,
          monsterId = 5266,
          description = "Capture one \"Demon Flower\" to \"Danny\"",
          consumeItems = {},
          rawFlowType = "capture"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3405,
          mapId = 204,
          count = nil,
          monsterId = 5266,
          description = "",
          consumeItems = {
            {
              templateId = 21390,
              quantity = 1,
              name = "Demon Flower Seed"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 496,
      title = "Demon Flower",
      startNpcId = 3777,
      minLevel = 93,
      prerequisiteTaskId = 495,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(496)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3405,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3778,
          mapId = 204,
          count = nil,
          monsterId = 5598,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3405,
          mapId = 204,
          count = nil,
          monsterId = 5599,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 497,
      title = "Examination Result",
      startNpcId = 3413,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3414,
          mapId = 210,
          count = nil,
          monsterId = 5259,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 498,
      title = "Ghost Fairy",
      startNpcId = 3779,
      minLevel = 95,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21269,
          quantity = 1,
          name = "Antelope Grass"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(498)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*4000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3418,
          mapId = 161,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21269,
              quantity = 1,
              name = "Antelope Grass"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3779,
          mapId = 161,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21392,
              quantity = 1,
              name = "Flower Heart"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3418,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "Bring \"Imperial Ranking\" to locate \"Ghost Fairy\"",
          consumeItems = {
            {
              templateId = 21268,
              quantity = 1,
              name = "Imperial Ranking"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3418,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "kill",
          npcId = 3418,
          mapId = 161,
          count = 15,
          monsterId = 5264,
          description = "Kill 15 \"Ice Demon\"",
          consumeItems = {},
          rawFlowType = "kill",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 5,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 499,
      title = "Fairy and Phoenix",
      startNpcId = 3418,
      minLevel = 95,
      prerequisiteTaskId = 498,
      acceptGrantItems = {
        {
          templateId = 21269,
          quantity = 1,
          name = "Antelope Grass"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(499)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3418,
          mapId = 161,
          count = nil,
          monsterId = nil,
          description = "Locate \"Hans\" and \"Steve\" to obtain \"Antelope Grass\" and \"Thorny Pill\"",
          consumeItems = {
            {
              templateId = 21269,
              quantity = 1,
              name = "Antelope Grass"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3418,
          mapId = 161,
          count = nil,
          monsterId = 5601,
          description = "",
          consumeItems = {
            {
              templateId = 21394,
              quantity = 1,
              name = "Ghost Fairy's Memory"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3418,
          mapId = 161,
          count = nil,
          monsterId = 5600,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 3,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 501,
      title = "Mysterious Kid",
      startNpcId = 3054,
      minLevel = 90,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21272,
          quantity = 1,
          name = "Heart Flower"
        }
      },
      rewards = {
        experience = 2000000,
        gold = 20000,
        coins = 30000,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = 2000000,
          gold = 20000,
          coins = 30000,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "macro_AddExp(2000000)\nmacro_AddMoney(20000)\nmacro_AddTongBan(30000)\n\nif(macro_GetSex()==1)then--nanren\n\tid={10802,11802,12802,13802,}\n\tiRand=macro_Rand(4)+1\n\tmacro_AddItem(id[iRand],1,0)\nelse\n\tid={15802,16802,17802,18802,}\n\tiRand=macro_Rand(4)+1\n\tmacro_AddItem(id[iRand],1,0)"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3433,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "Bring \"Heart Flower\" to \"Grocer\"",
          consumeItems = {
            {
              templateId = 21272,
              quantity = 1,
              name = "Heart Flower"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3414,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "½« \"Herb Medicine\" ½»¸ø\"Norman\"",
          consumeItems = {
            {
              templateId = 21273,
              quantity = 1,
              name = "Herb Medicine"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 2,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 502,
      title = "Ugly Heart",
      startNpcId = 3406,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3406,
          mapId = 186,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 503,
      title = "Caught in the Cross Fire",
      startNpcId = 3407,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 23104,
          quantity = 1,
          name = "Ice Dust"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3407,
          mapId = 186,
          count = nil,
          monsterId = 5264,
          description = "",
          consumeItems = {
            {
              templateId = 23104,
              quantity = 1,
              name = "Ice Dust"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3407,
          mapId = 186,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21274,
              quantity = 1,
              name = "Soul Grass"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 504,
      title = "Sandy",
      startNpcId = 3417,
      minLevel = 96,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21275,
          quantity = 1,
          name = "Magical Rope"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(504)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*1000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*1000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*1000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3409,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "Bring \"Magical Rope\" to \"Sandy\"",
          consumeItems = {
            {
              templateId = 21275,
              quantity = 1,
              name = "Magical Rope"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3409,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21275,
              quantity = 1,
              name = "Magical Rope"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 505,
      title = "Bad Temper",
      startNpcId = 3409,
      minLevel = 96,
      prerequisiteTaskId = 504,
      acceptGrantItems = {
        {
          templateId = 21276,
          quantity = 1,
          name = "Fang Ring"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(505)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*2000000,10))\n\tmacro_AddExp(macro_Chu(2*3000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*2000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*3000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*2000000,10))\n\tmacro_AddExp(macro_Chu(2*3000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3410,
          mapId = 130,
          count = nil,
          monsterId = 5267,
          description = "Kill \"Evil Fork\" and get \"Fang Ring\" .Then bring it to \"Tina\"",
          consumeItems = {
            {
              templateId = 21276,
              quantity = 1,
              name = "Fang Ring"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 506,
      title = "Pepperbox",
      startNpcId = 3409,
      minLevel = 96,
      prerequisiteTaskId = 505,
      acceptGrantItems = {
        {
          templateId = 21277,
          quantity = 1,
          name = "Glinting Hat"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(506)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*2000000,10))\n\tmacro_AddExp(macro_Chu(2*3000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*2000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*3000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*2000000,10))\n\tmacro_AddExp(macro_Chu(2*3000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "kill_collect",
          npcId = 3411,
          mapId = 130,
          count = nil,
          monsterId = 5268,
          description = "Kill \"Evil Reamer\" and obtain \"Glinting Hat\" . Then submit it to \"Linda\"",
          consumeItems = {
            {
              templateId = 21277,
              quantity = 1,
              name = "Glinting Hat"
            }
          },
          rawFlowType = "kill_collect",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 507,
      title = "Crush",
      startNpcId = 3409,
      minLevel = 96,
      prerequisiteTaskId = 506,
      acceptGrantItems = {},
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {
          {
            awardId = 1,
            items = {}
          }
        }
      },
      runtimeRewardChoices = {
        {
          awardId = 1,
          experience = nil,
          gold = nil,
          coins = nil,
          renown = nil,
          petTemplateIds = {},
          items = {},
          rawBody = "iTemp=28+macro_GetTaskLevelFromAll(507)-macro_GetPlayerAttr(32)\nif(iTemp<4)then\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))\nelseif(iTemp<29)then\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\n\tmacro_AddExp(macro_Chu(iTemp*4000000,20))\nelse\n\tmacro_AddExp(macro_Chu(2*4000000,10))\n\tmacro_AddExp(macro_Chu(2*4000000,10))"
        }
      },
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3414,
          mapId = 130,
          count = nil,
          monsterId = nil,
          description = "Take \"Sandy\" to leave \"Map 130\" and locate \"Norman\"",
          consumeItems = {},
          rawFlowType = "unknown"
        },
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3409,
          mapId = 204,
          count = nil,
          monsterId = 5602,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 508,
      title = "Icicle Lock",
      startNpcId = 3414,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21278,
          quantity = 1,
          name = "Icicle Lock"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3409,
          mapId = 204,
          count = nil,
          monsterId = 5289,
          description = "Travel to \"Map 152\" to defeat \"Soul Envoy\" and get \"Icicle Lock\" .Then bring it to \"Sandy\"",
          consumeItems = {
            {
              templateId = 21278,
              quantity = 1,
              name = "Icicle Lock"
            }
          },
          rawFlowType = "talk"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3414,
          mapId = 204,
          count = nil,
          monsterId = nil,
          description = "½« \"Icicle Lock\" ½»¸ø\"Norman\"",
          consumeItems = {
            {
              templateId = 21278,
              quantity = 1,
              name = "Icicle Lock"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 509,
      title = "Trap",
      startNpcId = 3421,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21279,
          quantity = 1,
          name = "First Gift"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3412,
          mapId = 152,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21279,
              quantity = 1,
              name = "First Gift"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3421,
          mapId = 130,
          count = nil,
          monsterId = 5591,
          description = "½« \"Nelson's Reply\" ½»¸ø\"Fiend\"",
          consumeItems = {
            {
              templateId = 21280,
              quantity = 1,
              name = "Nelson's Reply"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 510,
      title = "The Longest Song",
      startNpcId = 3421,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 21281,
          quantity = 1,
          name = "Sheet Music"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3421,
          mapId = 152,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 21281,
              quantity = 1,
              name = "Sheet Music"
            }
          },
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 1,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    },
    {
      taskId = 511,
      title = "The Most Diabolic Thing",
      startNpcId = 3421,
      minLevel = 1,
      prerequisiteTaskId = 0,
      acceptGrantItems = {
        {
          templateId = 20023,
          quantity = 1,
          name = "Grilled Mutton"
        }
      },
      rewards = {
        experience = 0,
        gold = 0,
        coins = 0,
        renown = 0,
        pets = {},
        items = {}
      },
      runtimeRewardChoices = {},
      steps = {
        {
          stepIndex = 1,
          type = "talk",
          npcId = 3412,
          mapId = 152,
          count = nil,
          monsterId = nil,
          description = "",
          consumeItems = {
            {
              templateId = 20023,
              quantity = 1,
              name = "Grilled Mutton"
            }
          },
          rawFlowType = "unknown"
        },
        {
          stepIndex = 2,
          type = "talk",
          npcId = 3421,
          mapId = 130,
          count = nil,
          monsterId = 5268,
          description = "",
          consumeItems = {},
          rawFlowType = "unknown",
          isCompletionStep = true
        }
      },
      evidence = {
        flowBlockCount = 2,
        runtimeRewardBlockCount = 1,
        sourcePriority = {
          reward = "runtime_reward_block > help_flow_text",
          stepText = "help_flow_text",
          killTarget = "help_flow_targetNpcId > role_name_inference",
          itemHandin = "help_flow_item_ids"
        }
      }
    }
  }
}
