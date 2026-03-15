

        macro_AddFightMonster(5079,0,1,15,1)
        macro_AddFightMonster(5074,0,3,16,2)


i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(5074,0,2,15,3)
elseif (i==2) then        
       	macro_AddFightMonster(5079,1,1,14,3)
elseif (i==3) then
	macro_AddFightMonster(5074,0,2,15,3)
	macro_AddFightMonster(5079,1,1,16,4)
end

