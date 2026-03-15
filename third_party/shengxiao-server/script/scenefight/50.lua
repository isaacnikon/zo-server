

        macro_AddFightMonster(5093,0,1,18,1)
        macro_AddFightMonster(5096,0,3,20,2)


i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(5093,0,2,20,3)
elseif (i==2) then        
       	macro_AddFightMonster(5096,1,1,19,3)
elseif (i==3) then
	macro_AddFightMonster(5093,0,2,20,3)
	macro_AddFightMonster(5096,1,1,19,4)
end


