	macro_AddFightMonster(5016,1,3,20,1)
if macro_GetGameSysTime(3)==0 and macro_GetGameSysTime(5)==1 then



i=macro_Rand(4)
if(i==1) then
       macro_AddFightMonster(28013,0,2,21,2)
elseif (i==2) then        
       	macro_AddFightMonster(5015,1,1,21,2)
elseif (i==3) then
	macro_AddFightMonster(28013,0,2,21,2)
	macro_AddFightMonster(5016,1,1,20,3)
end


end

